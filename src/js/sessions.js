// Chat sessions: a slide-in drawer to start new chats and browse/load/delete saved ones.
// Chats auto-save (after each reply) to data/sessions/*.json.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.sessions = (function () {
  function $(id) { return document.getElementById(id); }
  let currentId = null;
  let currentTitle = null;   // remembered so a rename isn't overwritten on the next auto-save
  let searchQuery = '';
  let searchTimer = null;

  // Build a gen bundle (per-chat generation settings) from a global config snapshot — used to
  // seed new chats and as a fallback for old sessions that have no stored settings.
  function cfgToGen(cfg) {
    return {
      model: cfg.model || 'glm-5.2',
      temperature: cfg.temperature != null ? cfg.temperature : 0.8,
      topP: cfg.topP != null ? cfg.topP : 0.95,
      maxTokens: cfg.maxTokens != null ? cfg.maxTokens : 0,
      thinking: !!cfg.thinking,
      reasoningEffort: cfg.reasoningEffort || 'max',
      streamCps: cfg.streamCps != null ? cfg.streamCps : 0,
      contextWindow: cfg.contextWindow != null ? cfg.contextWindow : 0,
    };
  }

  function open() { $('sidebar').classList.add('open'); }
  function close() { $('sidebar').classList.remove('open'); }
  function toggle() { $('sidebar').classList.toggle('open'); }

  function deriveTitle(messages) {
    const u = (messages || []).find((m) => m.role === 'user');
    const t = u ? u.content : '';
    return (t.replace(/\s+/g, ' ').trim().slice(0, 42)) || 'New chat';
  }
  function fmtTokens(t) {
    t = Number(t) || 0;
    if (t >= 1000000) return (t / 1000000).toFixed(2) + 'M tok';
    if (t >= 1000) return (t / 1000).toFixed(1) + 'k tok';
    return t + ' tok';
  }

  async function refresh() {
    const el = $('sessionList');
    el.replaceChildren();
    if (searchQuery) {
      let results = [];
      try { results = await window.api.searchSessions(searchQuery); } catch (e) {}
      $('sidebar').classList.toggle('has-items', results.length > 0);
      if (!results.length) {
        const empty = document.createElement('div');
        empty.className = 'sidebar-empty';
        empty.textContent = 'No chats match "' + searchQuery + '".';
        el.appendChild(empty);
        return;
      }
      for (const r of results) {
        const item = document.createElement('div');
        item.className = 'session-item search-result' + (r.id === currentId ? ' active' : '');
        item.dataset.id = r.id;
        const title = document.createElement('span');
        title.className = 'session-title';
        title.textContent = r.title || 'Untitled';
        const snip = document.createElement('div');
        snip.className = 'session-snip';
        snip.textContent = r.snippet || '';
        item.appendChild(title);
        item.appendChild(snip);
        el.appendChild(item);
      }
      return;
    }
    let list = [];
    try { list = await window.api.listSessions(); } catch (e) {}
    $('sidebar').classList.toggle('has-items', list.length > 0);
    let grandTokens = 0;
    for (const s of list) {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === currentId ? ' active' : '') + (s.pinned ? ' pinned' : '');
      item.dataset.id = s.id;
      const pin = document.createElement('button');
      pin.className = 'session-pin';
      pin.textContent = s.pinned ? '★' : '☆';
      pin.title = s.pinned ? 'Unpin' : 'Pin to top';
      const title = document.createElement('span');
      title.className = 'session-title';
      title.textContent = s.title || 'Untitled';
      const rename = document.createElement('button');
      rename.className = 'session-rename';
      rename.textContent = '✎';
      rename.title = 'Rename';
      const del = document.createElement('button');
      del.className = 'session-del';
      del.textContent = '×';
      del.title = 'Delete';
      const main = document.createElement('div');
      main.className = 'session-main';
      main.appendChild(title);
      if ((s.parentId && s.parentTitle) || (s.usage && s.usage.tokens > 0)) {
        const meta = document.createElement('div');
        meta.className = 'session-meta';
        if (s.parentId && s.parentTitle) { const lin = document.createElement('span'); lin.className = 'session-lineage'; lin.textContent = '↳ ' + s.parentTitle; meta.appendChild(lin); }
        if (s.usage && s.usage.tokens > 0) { const u = document.createElement('span'); u.className = 'session-usage'; u.textContent = fmtTokens(s.usage.tokens); meta.appendChild(u); }
        main.appendChild(meta);
      }
      item.appendChild(pin);
      item.appendChild(main);
      item.appendChild(rename);
      item.appendChild(del);
      if (s.usage) grandTokens += s.usage.tokens || 0;
      el.appendChild(item);
    }
    const foot = $('sidebarFoot');
    if (foot) foot.textContent = list.length ? (fmtTokens(grandTokens) + ' · ' + list.length + ' chat' + (list.length === 1 ? '' : 's')) : '';
  }

  async function newChat() {
    currentId = null;
    currentTitle = null;
    // A new chat starts from the default instruction files + default generation settings.
    let rp = '', proj = '';
    try { rp = (await window.api.loadModes()).roleplay || ''; } catch (e) {}
    try { proj = (await window.api.loadProject()) || ''; } catch (e) {}
    Constellation.chat.setPrompts({ roleplay: rp, project: proj });
    let gen = null;
    try { gen = cfgToGen(await window.api.loadConfig()); } catch (e) {}
    if (gen) Constellation.chat.setOptions(gen);   // don't inherit the previous chat's settings
    if (Constellation.chat.setDraft) Constellation.chat.setDraft('');
    Constellation.chat.reset();
    close();
    refresh();
  }

  async function load(id) {
    let s;
    try { s = await window.api.loadSession(id); } catch (e) { return; }
    currentId = s.id;
    currentTitle = s.title || null;
    // Restore this chat's own instructions; older chats without any fall back to the default files.
    let system = s.system, project = s.project;
    if (system === undefined && project === undefined) {
      try { system = (await window.api.loadModes()).roleplay || ''; } catch (e) {}
      try { project = (await window.api.loadProject()) || ''; } catch (e) {}
    }
    // Restore this chat's generation settings; older chats fall back to global defaults.
    let gen = s.gen;
    if (!gen) { try { gen = cfgToGen(await window.api.loadConfig()); } catch (e) {} }
    Constellation.chat.loadSession(s.messages || [], system, project, gen, s.usage);
    // Restore this chat's saved draft (if any), and — if we arrived via search — jump to the match.
    try { const drafts = await window.api.loadDrafts(); if (Constellation.chat.setDraft) Constellation.chat.setDraft(drafts[id] || ''); } catch (e) {}
    close();
    refresh();
    if (searchQuery && Constellation.chat.scrollToMatch) Constellation.chat.scrollToMatch(searchQuery);
  }

  async function saveCurrent(messages, system, project, gen, usage) {
    try {
      const title = currentTitle || deriveTitle(messages);
      const res = await window.api.saveSession({ id: currentId, title, messages, system, project, gen, usage });
      currentId = res.id;
      currentTitle = title;   // keep it across later auto-saves
      refresh();
    } catch (e) {}
  }

  // Create a new chat that branches off a conversation prefix (carrying the parent's instructions
  // + settings). The parent chat on disk is untouched.
  async function forkFrom(bundle) {
    try {
      const title = (deriveTitle(bundle.messages) || 'Fork') + ' · fork';
      const parentId = currentId, parentTitle = currentTitle;   // remember where this fork branched from
      const res = await window.api.saveSession({ id: null, title, messages: bundle.messages, system: bundle.system, project: bundle.project, gen: bundle.gen, parentId, parentTitle });
      await load(res.id);   // create + switch into the new fork
      if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Forked to "' + title + '"');
    } catch (e) {}
  }

  // Inline-rename a saved chat: swap the title for an input, save on Enter/blur, cancel on Esc.
  function startRename(item, id) {
    const titleEl = item.querySelector('.session-title');
    if (!titleEl || item.querySelector('.session-rename-input')) return;
    const original = titleEl.textContent;
    const input = document.createElement('input');
    input.className = 'session-rename-input';
    input.value = original;
    input.setAttribute('aria-label', 'Chat name');
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (v && v !== original) {
        try { await window.api.renameSession(id, v); } catch (e) {}
        if (id === currentId) currentTitle = v;   // so the next auto-save keeps the new name
      }
      refresh();
    };
    const cancel = () => { if (done) return; done = true; refresh(); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  function init() {
    $('sidebarToggle').addEventListener('click', toggle);
    $('newChat').addEventListener('click', newChat);

    // Click anywhere outside the drawer (and not on the ☰ toggle) to close it.
    document.addEventListener('click', (e) => {
      if (!$('sidebar').classList.contains('open')) return;
      if (e.target.closest('#sidebar')) return;
      if (e.target.closest('#sidebarToggle')) return;
      close();
    });
    $('sessionList').addEventListener('click', (e) => {
      const item = e.target.closest('.session-item');
      if (!item) return;
      const id = item.dataset.id;
      const del = e.target.closest('.session-del');
      const rename = e.target.closest('.session-rename');
      const pin = e.target.closest('.session-pin');
      if (del) {
        e.stopPropagation();
        window.api.deleteSession(id).then(() => {
          if (id === currentId) { currentId = null; Constellation.chat.reset(); }
          refresh();
        });
      } else if (rename) {
        e.stopPropagation();
        startRename(item, id);
      } else if (pin) {
        e.stopPropagation();
        const willPin = !item.classList.contains('pinned');
        window.api.setPinned(id, willPin).then(() => { refresh(); if (window.Constellation && window.Constellation.toast) window.Constellation.toast(willPin ? 'Pinned' : 'Unpinned'); });
      } else {
        load(id);
      }
    });
    const search = $('sessionSearch');
    if (search) search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchQuery = search.value.trim(); refresh(); }, 200);
    });
    refresh();
  }

  // Persist the in-progress input for the current chat (called by chat.js on input).
  function saveDraft(text) {
    if (currentId && window.api && window.api.saveDraft) {
      try { window.api.saveDraft(currentId, text); } catch (e) {}
    }
  }

  return { init, saveCurrent, forkFrom, saveDraft, open, close };
})();
