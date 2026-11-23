// Color FX: tags color words in rendered replies and drives the ambient glow + celestial events.
// The glow is ONE soft light parked on the color word on screen, so it follows the reading.
// Single color → proximity-weighted brightness + a cosmic event (supernova/comet/planet/star).
// Multiple colors on the same line → left-to-right queue cascade, each color gets its own event.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.colorfx = (function () {
  // The color bank, its everyday-word rule and the display tints are pure data + math in
  // Constellation.engines.colors (unit-tested there). colorfx does the DOM tagging.
  const COLOR = (window.Constellation.engines && window.Constellation.engines.colors) || null;
  const COLORWORD_RE = COLOR ? COLOR.pattern() : /(?!)/g;

  // How fast the glow falls off from its center. This replaces the old "blend" choices, which
  // did nothing on the true-black sky: soft-light and overlay emit no light over black, and
  // screen and normal are identical there (measured: 0.218 / 0.218 / 0 / 0 margin luminance).
  const FALLOFF = { soft: ['52%', '82%'], even: ['42%', '70%'], tight: ['30%', '56%'] };
  let params = { intensity: 0.5, range: 140, size: 35, falloff: 'soft', events: true, fxSize: 1, colorWords: true };
  function setParams(p) {
    if (!p) return;
    if (p.intensity != null) params.intensity = p.intensity;
    if (p.range != null) params.range = p.range;
    if (p.size != null) params.size = p.size;
    if (p.falloff != null) params.falloff = p.falloff;
    if (p.events != null) params.events = !!p.events;
    if (p.fxSize != null) params.fxSize = p.fxSize;
    if (p.colorWords != null) params.colorWords = !!p.colorWords;
    applyFlareShape(ensureFlare());
  }

  // Color words wear the soft ink tint; the glow throws the pastel of the same hue; the
  // celestial events keep the old dark-hue floor so they stay luminous.
  function inkColor(hex) { return (COLOR && COLOR.inkTint(hex)) || hex; }
  function glowColor(hex) { return (COLOR && COLOR.glowTint(hex)) || hex; }
  function eventColor(hex) { return (COLOR && COLOR.eventTint(hex)) || hex; }
  function rgbOf(hex) { return COLOR ? COLOR.hexToRgb(hex) : null; }

  function tagColors(body) {
    if (!body || !COLOR) return;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement && node.parentElement.classList.contains('colorword')) continue;
      if (!node.textContent.trim()) continue;
      nodes.push(node);
    }
    for (const node of nodes) {
      const text = node.textContent;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      COLORWORD_RE.lastIndex = 0;
      while ((m = COLORWORD_RE.exec(text)) !== null) {
        const word = m[0];
        const literal = word.startsWith('#');
        const color = literal ? word : COLOR.bank[word.toLowerCase()];
        if (!color) continue;
        // A bank word is only a color HERE when it reads as one: a capitalized name
        // mid-sentence ("Amber said") and a thing-word with no color cue ("the fog") are left alone.
        if (!literal && !COLOR.isColorHere(word, text.slice(Math.max(0, m.index - 48), m.index), text.slice(m.index + word.length, m.index + word.length + 24))) continue;
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement('span');
        span.className = 'colorword';
        span.dataset.color = color;
        if (params.colorWords) span.style.color = inkColor(color);   // the word wears its color as a soft tinted ink
        span.textContent = word;
        frag.appendChild(span);
        last = m.index + word.length;
      }
      if (last === 0) continue;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  // --- The ambient glow: one soft light that sits on the color word on screen ---
  let flare = null;
  // The sky layers are siblings that paint in DOM order above the starfield:
  // mood wash → celestial events → glow.
  function skyAnchor() {
    const wash = document.getElementById('moodWash');
    if (wash && wash.parentNode) return wash;
    const canvas = document.getElementById('starfield');
    return (canvas && canvas.parentNode) ? canvas : null;
  }
  function intoSky(el) {
    const a = skyAnchor();
    if (a) a.parentNode.insertBefore(el, a.nextSibling); else document.body.appendChild(el);
  }
  function applyFlareShape(f) {
    // Spread (percent) → diameter of the light: 35% is a ~1120px pool, a 560px radius.
    f.style.setProperty('--flare-d', Math.round(Math.min(2200, Math.max(420, params.size * 32))) + 'px');
    const fo = FALLOFF[params.falloff] || FALLOFF.soft;
    f.style.setProperty('--flare-mid', fo[0]);
    f.style.setProperty('--flare-end', fo[1]);
  }
  function ensureFlare() {
    if (flare) return flare;
    flare = document.createElement('div');
    flare.id = 'colorFlare';
    applyFlareShape(flare);
    intoSky(flare);
    return flare;
  }
  // Park the light on a point (the center of the word that caused it) with its color and level.
  function lightAt(x, y, color, level) {
    const f = ensureFlare();
    f.style.setProperty('--flare-x', Math.round(Math.max(0, Math.min(window.innerWidth, x))) + 'px');
    f.style.setProperty('--flare-y', Math.round(Math.max(0, Math.min(window.innerHeight, y))) + 'px');
    f.style.setProperty('--flare-color', color);
    f.style.opacity = String(Math.max(0, Math.min(1, level)));
  }
  function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  // --- Celestial events: weighted archetype pool ---
  // The old ray-burst dominated and everything read as the same "pinwheel"; now soft nebulae,
  // crisp glints, expanding rings and stardust clusters share the sky, with the supernova rare.
  const FX_POOL = [
    'fx-nebula', 'fx-nebula', 'fx-glint', 'fx-glint', 'fx-ring', 'fx-ring',
    'fx-stardust', 'fx-stardust', 'fx-star', 'fx-star', 'fx-comet', 'fx-comet',
    'fx-planet', 'fx-planet', 'fx-supernova',
  ];
  let activeFx = 0;      // concurrency cap — a 15-color passage must not stack a wall of shapes
  let lastSpawnAt = 0;   // minimum spacing between spawns
  function spawnEffect(color) {
    if (!params.events) return;   // cosmic events toggled off — glow only
    const now = Date.now();
    if (activeFx >= 4 || now - lastSpawnAt < 350) return;   // declutter: cap concurrency + spacing
    let type = FX_POOL[Math.floor(Math.random() * FX_POOL.length)];
    if (type === 'fx-nebula' && document.querySelector('.fx-nebula')) type = 'fx-ring';   // one nebula at a time — two overlapping 55vmin washes overloads compositing
    const el = document.createElement('div');
    el.className = type;
    el.style.setProperty('--fx-color', ((type === 'fx-nebula' ? glowColor(color) : eventColor(color)) || color));
    const dx = Math.round(Math.random() * 240 - 120);
    const dy = Math.round(Math.random() * 180 - 90);
    el.style.setProperty('--fx-dx', dx + 'px');
    el.style.setProperty('--fx-dy', dy + 'px');
    // Variance: random rotation, size multiplier (× user event-size), texture offset, shadow angle.
    el.style.setProperty('--fx-scale', ((0.7 + Math.random() * 0.6) * params.fxSize).toFixed(2));
    el.style.setProperty('--fx-tx', Math.round(Math.random() * 8 - 4) + 'px');
    el.style.setProperty('--fx-ty', Math.round(Math.random() * 8 - 4) + 'px');
    el.style.setProperty('--fx-shadow-angle', Math.round(Math.random() * 360) + 'deg');
    // For comets: orient the tail opposite to travel direction; others: random rotation.
    if (type === 'fx-comet') el.style.setProperty('--fx-angle', Math.round(Math.atan2(dy, dx) * 180 / Math.PI) + 'deg');
    else el.style.setProperty('--fx-angle', Math.round(Math.random() * 360) + 'deg');
    if (type === 'fx-nebula') {
      // Nebulae are the wash layer: huge, faint, and free to roam the full width — the frosted
      // chat bubbles (backdrop-blur) tint through them, so color washes over the reading column.
      el.style.left = (5 + Math.random() * 90) + '%';
      el.style.top = (15 + Math.random() * 70) + '%';
      el.style.setProperty('--fx-scale', ((0.85 + Math.random() * 0.4) * params.fxSize).toFixed(2));
    } else {
      // Spawn in the side MARGINS. The column width comes from the --chat-col variable —
      // #messages itself spans the whole viewport, so measuring it leaves "no room" and
      // killed every event. If the window is too narrow for real margins, skip (no event
      // beats an event over the text).
      const W = window.innerWidth;
      let col = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-col')) || 880;
      col = Math.min(col, W);
      const colL = (W - col) / 2, colR = colL + col;
      const leftRoom = colL - 44, rightRoom = (W - colR) - 44;   // 16px edge inset + 28px kept clear of the text
      let x;
      if (leftRoom >= 60 && rightRoom >= 60) x = Math.random() < 0.5 ? 16 + Math.random() * leftRoom : colR + 28 + Math.random() * rightRoom;
      else if (leftRoom >= 60) x = 16 + Math.random() * leftRoom;
      else if (rightRoom >= 60) x = colR + 28 + Math.random() * rightRoom;
      else return;   // no margin room (narrow window) — skip rather than touch text
      el.style.left = Math.round(x) + 'px';
      el.style.top = (10 + Math.random() * 80) + '%';
    }
    intoSky(el);
    activeFx++; lastSpawnAt = now;
    const gone = function () { if (!el.parentNode) return; el.remove(); activeFx = Math.max(0, activeFx - 1); };
    el.addEventListener('animationend', gone);
    setTimeout(gone, 8000);   // safety (longest animation is 7s)
  }

  // --- Phase 2: queue cascade for multi-color lines ---
  let queueColors = null, queueIdx = 0, queueTimer = null;
  const QUEUE_MS = 1500;
  function clearQueue() { if (queueTimer) { clearTimeout(queueTimer); queueTimer = null; } queueColors = null; queueIdx = 0; }
  function startQueue(items) { clearQueue(); queueColors = items; queueIdx = 0; playQueueItem(); }
  function playQueueItem() {
    if (!queueColors || queueIdx >= queueColors.length) { clearQueue(); ensureFlare().style.opacity = '0'; return; }
    const item = queueColors[queueIdx];
    if (item && item.el) {
      // The light hops to each word in reading order — a line of colors reads left to right.
      const c = centerOf(item.el);
      lightAt(c.x, c.y, glowColor(item.hex), params.intensity);
      spawnEffect(item.hex);   // each queued color fires its own celestial event
    }
    queueIdx++;
    queueTimer = setTimeout(playQueueItem, QUEUE_MS);
  }

  // --- Track which color words have already fired an event (one per pass) ---
  const fired = new Set();
  // Typing nudges the scroll ~21px per keystroke and the pre-paint correction undoes it — a
  // word near the scan-range boundary "leaves and returns" within one frame pair, which used
  // to re-arm it and fire a celestial event PER KEYSTROKE. A per-word cooldown plus a
  // flare-visual gate (only update on real movement) make typing sky-silent.
  const lastFiredAt = new Map();
  const REFIRE_COOLDOWN_MS = 1600;
  let lastFlareKey = '';

  // --- The scan: finds nearby color words, drives flare + fires events ---
  // Wrapper: skip the scan entirely when the chat hasn't moved (the rects can't have
  // changed), and THROTTLE the rest — during a stream or a fast scroll the scroll events
  // arrive far faster than the flare can visibly change, so at most one scan runs per
  // ~100ms, with a trailing pass that settles the flare at the final position. Every
  // scroll event used to re-measure EVERY color word in the chat — in a long conversation
  // that is real layout work per keystroke-nudge.
  const SCAN_MIN_GAP = 100;
  let lastScanTop = -1;
  let lastScanAt = -SCAN_MIN_GAP;
  let scanTrailing = null;
  function runScan(messagesEl) {
    const t0 = performance.now();
    try { scanInner(messagesEl); }
    finally { if (window.Constellation && window.Constellation.diag) window.Constellation.diag.span('colorfx.scan', performance.now() - t0); }
  }
  function scan(messagesEl) {
    const top = messagesEl.scrollTop;
    if (top === lastScanTop) return;
    lastScanTop = top;
    const now = performance.now();
    const since = now - lastScanAt;
    if (since < SCAN_MIN_GAP) {
      if (scanTrailing == null) {
        scanTrailing = setTimeout(function () {   // trailing pass — the flare settles where the reader stopped
          scanTrailing = null;
          lastScanAt = performance.now();
          runScan(messagesEl);
        }, SCAN_MIN_GAP - since + 10);
      }
      return;
    }
    lastScanAt = now;
    runScan(messagesEl);
  }
  function scanInner(messagesEl) {
    const f = ensureFlare();
    const centerY = window.innerHeight / 2;
    const words = messagesEl.querySelectorAll('.colorword');
    const nearby = [];
    for (const w of words) {
      const r = w.getBoundingClientRect();
      const wc = r.top + r.height / 2;
      const dist = Math.abs(wc - centerY);
      if (dist >= params.range) continue;
      const rgb = rgbOf(w.dataset.color);
      if (!rgb) continue;
      nearby.push({ el: w, hex: w.dataset.color, rgb: rgb, dist: dist, prox: 1 - dist / params.range, x: r.left + r.width / 2, y: wc });
    }
    if (!nearby.length) { if (!queueColors && f.style.opacity !== '0') f.style.opacity = '0'; return; }

    // Clean stale fired entries (words no longer nearby can re-fire next pass).
    const nearbyEls = new Set(nearby.map(function (n) { return n.el; }));
    for (const el of fired) if (!nearbyEls.has(el)) { fired.delete(el); lastFiredAt.delete(el); }

    // Group by vertical (same line ≈ within 24px Y).
    nearby.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    const groups = []; let cur = [nearby[0]];
    for (let i = 1; i < nearby.length; i++) {
      if (Math.abs(nearby[i].y - cur[0].y) < 24) cur.push(nearby[i]);
      else { groups.push(cur); cur = [nearby[i]]; }
    }
    groups.push(cur);

    // Pick the group closest to the scan line.
    let best = groups[0], bestAvg = best.reduce(function (s, w) { return s + w.dist; }, 0) / best.length;
    for (const g of groups) { const avg = g.reduce(function (s, w) { return s + w.dist; }, 0) / g.length; if (avg < bestAvg) { best = g; bestAvg = avg; } }

    if (best.length > 1) {
      // Multi-color line → queue cascade.
      const hexes = best.map(function (w) { return w.hex; });
      if (!queueColors || queueColors.map(function (q) { return q.hex; }).join(',') !== hexes.join(',')) startQueue(best.map(function (w) { return { hex: w.hex, el: w.el }; }));
    } else {
      // Single color → proximity-driven weighted blend.
      clearQueue();
      let tr = 0, tg = 0, tb = 0, tw = 0, maxP = 0, maxEl = null;
      for (const w of nearby) {
        tr += w.rgb.r * w.prox; tg += w.rgb.g * w.prox; tb += w.rgb.b * w.prox; tw += w.prox;
        if (w.prox > maxP) { maxP = w.prox; maxEl = w.el; }
      }
      if (tw > 0) {
        // Visual gate: only touch the flare when the driving group actually changed or moved
        // a real amount (>16px) — keystroke-scale jitter must not breathe the glow.
        const key = nearby[0].el + '|' + Math.round(nearby[0].y / 16);
        if (key !== lastFlareKey) {
          lastFlareKey = key;
          // The light sits on the nearest color word, in the pastel of the weighted blend.
          const anchor = centerOf(maxEl || nearby[0].el);
          const tint = COLOR ? COLOR.glowTintRgb({ r: Math.round(tr / tw), g: Math.round(tg / tw), b: Math.round(tb / tw) }) : null;
          lightAt(anchor.x, anchor.y, tint || '#ffffff', maxP * params.intensity);
        }
        // Fire a celestial event when a color word is very close to the scan line — once per
        // pass AND never twice for the same word inside the cooldown window.
        const now = Date.now();
        if (maxP > 0.6 && maxEl && !fired.has(maxEl) && now - (lastFiredAt.get(maxEl) || 0) > REFIRE_COOLDOWN_MS) {
          fired.add(maxEl);
          lastFiredAt.set(maxEl, now);
          if (window.Constellation && window.Constellation.diag) window.Constellation.diag.note('flare', maxEl.textContent);   // flight recorder: WHEN flares fire, and next to what
          spawnEffect(nearby.find(function (n) { return n.el === maxEl; }).hex);
        }
      }
    }
  }

  // Re-tint (or clear) the color words already on screen — lets Settings toggle colored text
  // without re-rendering the whole conversation.
  function retint(messagesEl) {
    if (!messagesEl) return;
    for (const w of messagesEl.querySelectorAll('.colorword')) {
      w.style.color = params.colorWords ? (inkColor(w.dataset.color) || '') : '';
    }
  }

  return { tagColors: tagColors, scan: scan, setParams: setParams, retint: retint };
})();
