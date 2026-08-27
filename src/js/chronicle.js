// Chronicle — the reader's reference panel. A slim tab on the right edge pulls open a per-chat
// list of durable story facts: who knows what, who's hurt, what was promised, where things stand.
// "Capture from story" distills the conversation with flash (extraction, not summary — intimate
// scenes become plain plot facts). Facts are editable and deletable: it's YOUR memory, the model
// just takes notes for you. Nothing here is sent to the model during chats.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.chronicle = (function () {
  let chatId = null, facts = [], tab = null, panel = null, listEl = null, busy = false;

  function ensureDom() {
    if (tab) return;
    tab = document.createElement('button');
    tab.className = 'chronicle-tab';
    tab.type = 'button';
    tab.title = 'Chronicle — your story\'s memory (reader reference)';
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
    const cap = document.createElement('button');
    cap.className = 'btn chronicle-capture'; cap.type = 'button'; cap.textContent = '✦ Capture from story';
    cap.addEventListener('click', capture);
    const note = document.createElement('input');
    note.className = 'chronicle-note'; note.type = 'text'; note.placeholder = '+ add your own note, Enter…';
    note.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && note.value.trim()) { add(note.value.trim()); note.value = ''; }
    });
    actions.appendChild(cap); actions.appendChild(note);

    listEl = document.createElement('div');
    listEl.className = 'chronicle-list';

    panel.appendChild(head); panel.appendChild(hint); panel.appendChild(actions); panel.appendChild(listEl);
    document.body.appendChild(panel);

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  function toggle() { panel.classList.contains('open') ? close() : open(); }
  function open() { ensureDom(); panel.classList.add('open'); }
  function close() { if (panel) panel.classList.remove('open'); }

  function persist() {
    if (!chatId) return;
    try { window.api.saveChronicle(chatId, facts); } catch (e) {}
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
      e.textContent = 'Nothing captured yet. Bookmark-worthy events, promises, secrets — Capture distills them, or add notes yourself.';
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

  async function capture() {
    if (busy || !chatId) return;
    if (!(window.Constellation.chat && window.Constellation.chat.recentMessages)) return;
    busy = true;
    const btn = panel.querySelector('.chronicle-capture');
    const orig = btn.textContent;
    btn.textContent = '✦ reading the story…';
    btn.disabled = true;
    try {
      const fresh = await window.api.extractChronicle(window.Constellation.chat.recentMessages(200));
      const have = new Set(facts.map(function (f) { return f.toLowerCase(); }));
      let added = 0;
      for (const f of fresh) {
        if (!have.has(f.toLowerCase())) { facts.push(f); have.add(f.toLowerCase()); added++; }
      }
      persist(); render();
      if (window.Constellation.toast) window.Constellation.toast(added ? added + (added === 1 ? ' fact' : ' facts') + ' added to the chronicle' : 'Nothing new to record');
    } catch (e) {
      if (window.Constellation.toast) window.Constellation.toast('Capture failed: ' + String(e.message || e).slice(0, 120));
    } finally {
      busy = false; btn.textContent = orig; btn.disabled = false;
    }
  }

  async function setChat(id) {
    chatId = id || null;
    facts = [];
    if (chatId) {
      try { facts = await window.api.loadChronicle(chatId); } catch (e) {}
    }
    render();
  }

  return { setChat: setChat, open: open, close: close, toggle: toggle };
})();
