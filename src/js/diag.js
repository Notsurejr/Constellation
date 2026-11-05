// Diagnostics — the flight recorder. It listens quietly all the time (heap samples, long
// frames, scroll movements, keystroke RATE — never content, flares, and how long the
// expensive steps take). When something misbehaves, the evidence is already in memory:
// Settings → System → "Capture diagnostics report" writes it to a text file to read or
// hand over. Every buffer is a bounded ring; steady-state cost is a few pushes a second.
var Constellation = window.Constellation || {};
Constellation.diag = (function () {
  const MAX = {
    heap: 80,      // 15s apart → the last 20 minutes
    frames: 60,    // frames slower than 50ms
    scrolls: 90,   // scroll positions (movements, and big jumps always recorded)
    keys: 60,      // keystroke counts per 10s bucket — RATE only, never text
    events: 60,    // named events (color flares, render finishes, …)
    spanRec: 16,   // recent timings per named span
  };
  const heap = [];        // {t, used, total} — renderer JS heap (KB)
  const frames = [];      // {t, ms}
  const scrolls = [];     // {t, top, jump} — jump = |Δ| px when > 60
  const keys = [];        // {t, n}
  const events = [];      // {t, kind, detail}
  const spans = {};       // name -> {last, max, count, rec: [{t, ms}]}
  let bootedAt = performance.now();
  let fpsAvg = 0, frameCount = 0, frameWinT = performance.now();

  function push(arr, v, cap) { if (arr.length >= cap) arr.shift(); arr.push(v); }

  function span(name, ms) {
    ms = Math.max(0, Math.round(ms * 10) / 10);
    let s = spans[name];
    if (!s) s = spans[name] = { last: 0, max: 0, count: 0, rec: [] };
    s.last = ms; if (ms > s.max) s.max = ms; s.count++;
    push(s.rec, { t: Date.now(), ms: ms }, MAX.spanRec);
  }
  function note(kind, detail) { push(events, { t: Date.now(), kind: String(kind || '?'), detail: String(detail || '').slice(0, 60) }, MAX.events); }
  function keyTick() {
    const now = Date.now();
    const b = keys[keys.length - 1];
    if (b && now - b.t < 10000) b.n++;
    else push(keys, { t: now, n: 1 }, MAX.keys);
  }

  function init() {
    bootedAt = performance.now();
    // Renderer heap samples (Chromium-only API; absent → the section just reports n/a).
    setInterval(function () {
      const m = performance && performance.memory;
      if (m) push(heap, { t: Date.now(), used: Math.round(m.usedJSHeapSize / 1024), total: Math.round(m.totalJSHeapSize / 1024) }, MAX.heap);
    }, 15000);
    // Frame timing: log the SLOW ones (>50ms) and keep a rolling fps estimate.
    let prev = performance.now();
    requestAnimationFrame(function loop(t) {
      const dt = t - prev; prev = t;
      if (dt > 30000) { frameWinT = t; frameCount = 0; }   // woke from sleep/occlusion — the gap is not a frame
      else {
        frameCount++;
        if (dt > 50) push(frames, { t: Date.now(), ms: Math.round(dt) }, MAX.frames);
      }
      if (t - frameWinT >= 5000) { fpsAvg = Math.round((frameCount * 1000) / (t - frameWinT)); frameCount = 0; frameWinT = t; }
      requestAnimationFrame(loop);
    });
    // Scroll movements on the chat — the raw trail a jump-when-finishes leaves behind.
    const msgs = document.getElementById('messages');
    if (msgs) {
      let lastTop = msgs.scrollTop, lastRec = 0;
      msgs.addEventListener('scroll', function () {
        const top = msgs.scrollTop;
        const jump = Math.abs(top - lastTop);
        const now = Date.now();
        if (jump > 60 || now - lastRec > 250) { push(scrolls, { t: now, top: Math.round(top), jump: Math.round(jump) }, MAX.scrolls); lastRec = now; }
        lastTop = top;
      }, { passive: true });
    }
    // Keystroke RATE on any text field (counts only — key text is never recorded).
    document.addEventListener('keydown', function (e) {
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) keyTick();
    }, { passive: true, capture: true });
  }

  // A point-in-time census, gathered at capture time.
  function snapshot() {
    const msgs = document.getElementById('messages');
    const chatState = (window.Constellation && window.Constellation.chat && window.Constellation.chat.getState) ? window.Constellation.chat.getState() : null;
    let nodes = 0, fx = 0, colorwords = 0;
    if (msgs) {
      nodes = msgs.querySelectorAll('*').length;
      fx = msgs.querySelectorAll('[class*="fx-"]').length;
      colorwords = msgs.querySelectorAll('.colorword').length;
    }
    return {
      at: new Date().toISOString(),
      uptimeMin: Math.round((performance.now() - bootedAt) / 60000),
      fps5s: fpsAvg,
      domNodesInChat: nodes, fxElements: fx, colorWords: colorwords,
      messages: chatState ? (chatState.messageCount != null ? chatState.messageCount : '?') : '?',
      heapKB: (performance && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1024) : null,
      scroller: msgs ? { top: Math.round(msgs.scrollTop), h: msgs.scrollHeight, vh: msgs.clientHeight } : null,
    };
  }

  function payload() {
    return {
      snapshot: snapshot(),
      heap: heap.slice(), frames: frames.slice(), scrolls: scrolls.slice(),
      keys: keys.slice(), events: events.slice(),
      spans: Object.keys(spans).map(function (k) { return { name: k, last: spans[k].last, max: spans[k].max, count: spans[k].count, rec: spans[k].rec.slice() }; }),
    };
  }

  async function captureAndSave() {
    try {
      const res = await window.api.diagReport(payload());
      if (res && res.ok && window.Constellation && window.Constellation.toast) {
        window.Constellation.toast('Diagnostics written — ' + res.path, 9000);
      }
      return res;
    } catch (e) { console.warn('[constellation]', e && e.message || e); return null; }
  }

  return { init: init, span: span, note: note, keyTick: keyTick, payload: payload, captureAndSave: captureAndSave };
})();
