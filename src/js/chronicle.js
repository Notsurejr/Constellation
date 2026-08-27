// Chronicle — the reader's reference panel. A slim tab on the right edge pulls open a per-chat
// list of durable story facts: who knows what, who's hurt, what was promised, where things stand.
// "Capture" reads only what's NEW since the last pass (the chat is processed in sequential
// ~11k-char chunks — chronological, rate-limit-friendly, and each finished pass shows up on the
// progress bar so you can see it working). "Rebuild" wipes and re-reads the whole story.
// Facts are editable and deletable: it's YOUR memory; nothing here is sent to the model in chats.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.chronicle = (function () {
  let chatId = null, facts = [], seen = 0, busy = false, rebuildArmed = false, rebuildTimer = null;
  let tab = null, panel = null, listEl = null, capBtn = null, rebuildBtn = null, progWrap = null, progFill = null, progLabel = null;

  function ensureDom() {
    if (tab) return;
    tab = document.createElement('button');
    tab.className = 'chronicle-tab';
    tab.type = 'button';
    tab.title = "Chronicle — your story's memory (reader reference)";
    tab.textContent = 'CHRONICLE';
    tab.addEventListener('click', toggle);
    document.body.appendChild(tab);

    panel = document.createElement('aside');
    panel.className = 'chronicle-panel';
    const head = document.createElement('div');
    head.className = 'chronicle-head';
    const h = document.createElement('div');
    h.className = 'chronicle-title';
    h.textContent = '❖ Chronicle';
    const x = document.createElement('button');
    x.className = 'chronicle-close'; x.type = 'button'; x.textContent = '×'; x.title = 'Close';
    x.addEventListener('click', close);
    head.appendChild(h); head.appendChild(x);

    const hint = document.createElement('div');
    hint.className = 'chronicle-hint';
    hint.textContent = 'Durable facts of this story — for you, the reader. Nothing here is sent to the model.';

    const actions = document.createElement('div');
    actions.className = 'chronicle-actions';
    capBtn = document.createElement('button');
    capBtn.className = 'btn chronicle-capture'; capBtn.type = 'button'; capBtn.textContent = '✦ Capture new';
    capBtn.title = 'Read what has happened since the last pass and record the durable facts';
    capBtn.addEventListener('click', function () { capture(false); });
    rebuildBtn = document.createElement('button');
    rebuildBtn.className = 'btn ghost chronicle-rebuild'; rebuildBtn.type = 'button'; rebuildBtn.textContent = '↻ Rebuild';
    rebuildBtn.title = 'Clear this chronicle and re-read the whole story from the beginning';
    rebuildBtn.addEventListener('click', function () {
      if (busy) return;
      if (!rebuildArmed) {   // two-step confirm — a rebuild replaces everything on record
        rebuildArmed = true;
        rebuildBtn.textContent = '↻ Rebuild — sure?';
        rebuildBtn.classList.add('warn');
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(disarmRebuild, 3500);
        return;
      }
      disarmRebuild();
      capture(true);
    });
    progWrap = document.createElement('div');
    progWrap.className = 'chronicle-progress';
    progFill = document.createElement('div');
    progFill.className = 'chronicle-progress-fill';
    progLabel = document.createElement('span');
    progLabel.className = 'chronicle-progress-label';
    progWrap.appendChild(progFill); progWrap.appendChild(progLabel);
    const cancel = document.createElement('button');
    cancel.className = 'chronicle-progress-cancel'; cancel.type = 'button'; cancel.textContent = '✕ stop';
    cancel.title = 'Stop the capture — everything read so far is kept';
    cancel.addEventListener('click', function () { try { window.api.cancelChronicle(); } catch (e) {} });
    progWrap.appendChild(cancel);
    const btnRow = document.createElement('div');
    btnRow.className = 'chronicle-btnrow';
    btnRow.appendChild(capBtn); btnRow.appendChild(rebuildBtn);
    const note = document.createElement('input');
    note.className = 'chronicle-note'; note.type = 'text'; note.placeholder = '+ add your own note, Enter…';
    note.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && note.value.trim()) { add(note.value.trim()); note.value = ''; }
    });
    actions.appendChild(btnRow); actions.appendChild(progWrap); actions.appendChild(note);

    listEl = document.createElement('div');
    listEl.className = 'chronicle-list';

    panel.appendChild(head); panel.appendChild(hint); panel.appendChild(actions); panel.appendChild(listEl);
    document.body.appendChild(panel);

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    if (window.api && window.api.onChronicleProgress) {
      window.api.onChronicleProgress(function (p) {
        if (!progWrap) return;
        const total = p && p.total || 1, done = p && p.done || 0;
        progFill.style.width = Math.round((done / total) * 100) + '%';
        progLabel.textContent = 'reading… pass ' + done + ' of ' + total;
      });
    }
  }

  function disarmRebuild() { rebuildArmed = false; if (rebuildBtn) { rebuildBtn.textContent = '↻ Rebuild'; rebuildBtn.classList.remove('warn'); } }

  function toggle() { panel.classList.contains('open') ? close() : open(); }
  function open() { ensureDom(); panel.classList.add('open'); }
  function close() { if (panel) panel.classList.remove('open'); }

  function persist() {
    if (!chatId) return;
    try { window.api.saveChronicle(chatId, facts, seen); } catch (e) {}
  }

  function render() {
    ensureDom();
    listEl.replaceChildren();
    if (!chatId) {
      const e = document.createElement('div');
      e.className = 'chronicle-empty';
      e.textContent = 'Open a chat to keep its chronicle.';
      listEl.appendChild(e);
      return;
    }
    if (!facts.length) {
      const e = document.createElement('div');
      e.className = 'chronicle-empty';
      e.textContent = 'Nothing on record yet. Capture distills the durable facts — promises, secrets, injuries, turning points — or add notes yourself.';
      listEl.appendChild(e);
    }
    facts.forEach(function (text, i) {
      const row = document.createElement('div');
      row.className = 'chronicle-fact';
      const t = document.createElement('span');
      t.className = 'chronicle-fact-text';
      t.textContent = text;
      t.title = 'Click to edit';
      t.addEventListener('click', function () {
        if (t.querySelector('textarea')) return;
        const ta = document.createElement('textarea');
        ta.value = text; ta.rows = 2;
        t.replaceChildren(ta); ta.focus();
        const done = function () {
          const v = ta.value.replace(/\s+/g, ' ').trim();
          if (v && v !== text) { facts[i] = v; persist(); }
          render();
        };
        ta.addEventListener('blur', done);
        ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(); } });
      });
      const del = document.createElement('button');
      del.className = 'chronicle-fact-del'; del.type = 'button'; del.textContent = '×'; del.title = 'Remove';
      del.addEventListener('click', function () { facts.splice(i, 1); persist(); render(); });
      row.appendChild(t); row.appendChild(del);
      listEl.appendChild(row);
    });
  }

  function add(text) { facts.push(text.slice(0, 400)); persist(); render(); }

  function setBusy(v) {
    busy = v;
    capBtn.disabled = v; rebuildBtn.disabled = v;
    capBtn.classList.toggle('working', v);
    progWrap.classList.toggle('on', v);
    if (!v) { progFill.style.width = '0%'; progLabel.textContent = ''; }
  }

  async function capture(rebuild) {
    if (busy || !chatId) return;
    if (!(window.Constellation.chat && window.Constellation.chat.recentMessages)) return;
    const allMsgs = window.Constellation.chat.recentMessages(100000);
    const fresh = rebuild ? allMsgs : allMsgs.slice(seen);
    if (!fresh.length) {
      if (window.Constellation.toast) window.Constellation.toast('Chronicle is up to date — Rebuild re-reads the whole story');
      return;
    }
    if (rebuild) { facts = []; seen = 0; render(); persist(); }
    setBusy(true);
    progLabel.textContent = 'reading… pass 1 of ?';
    try {
      const res = await window.api.captureChronicle(fresh);
      const have = new Set(facts.map(function (f) { return f.toLowerCase(); }));
      let added = 0;
      for (const f of (res && res.facts) || []) {
        if (!have.has(f.toLowerCase())) { facts.push(f); have.add(f.toLowerCase()); added++; }
      }
      seen += (res && res.coveredMsgs) || 0;
      persist(); render();
      if (window.Constellation.toast) {
        if (res && res.complete === false) window.Constellation.toast('Capture stopped — ' + added + ' facts kept from what was read');
        else window.Constellation.toast(added ? added + (added === 1 ? ' fact' : ' facts') + ' recorded' : 'Nothing new to record');
      }
    } catch (e) {
      if (window.Constellation.toast) window.Constellation.toast('Capture failed: ' + String(e.message || e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  }

  async function setChat(id) {
    chatId = id || null;
    facts = []; seen = 0;
    if (chatId) {
      try { const r = await window.api.loadChronicle(chatId); facts = (r && r.facts) || []; seen = (r && r.seen) || 0; } catch (e) {}
    }
    render();
  }

  return { setChat: setChat, open: open, close: close, toggle: toggle };
})();
