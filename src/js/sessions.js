// Chat sessions: a slide-in drawer to start new chats and browse/load/delete saved ones.
// Chats auto-save (after each reply) to data/sessions/*.json.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.sessions = (function () {
  function $(id) { return document.getElementById(id); }
  let currentId = null;
  let currentTitle = null;   // remembered so a rename isn't overwritten on the next auto-save
  let currentLore = [];     // lorebook ids enabled for the current chat (empty = lore off)
  let searchQuery = '';
  let searchTimer = null;
  let folders = {};   // folderId -> { id, name, collapsed }
  let showHidden = false;   // hidden chats stay tucked away until the footer toggle reveals them

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

  function open() {
    $('sidebar').classList.add('open');
    // Land the list on the chat you're actually in — not the newest one at the top.
    // setTimeout, not rAF: rAF never fires while the window is backgrounded/occluded.
    setTimeout(() => {
      const active = $('sessionList') && $('sessionList').querySelector('.session-item.active');
      if (!active) return;
      const fc = active.closest('.folder-children');   // if its folder is collapsed, open it for this look
      if (fc && fc.style.display === 'none') fc.style.display = '';
      if (active.scrollIntoView) active.scrollIntoView({ block: 'center' });
    }, 80);
  }
  function close() { $('sidebar').classList.remove('open'); }
  function toggle() {
    if ($('sidebar').classList.contains('open')) close();
    else open();   // through open() so the list lands on the active chat
  }

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

  // Build a single session-item row (reused for pinned, foldered, and top-level chats).
  function makeItem(s, indented) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === currentId ? ' active' : '') + (s.pinned ? ' pinned' : '') + (indented ? ' indented' : '') + (s.hidden ? ' hidden-chat' : '');
    item.dataset.id = s.id;
    const pin = document.createElement('button');
    pin.className = 'session-pin'; pin.textContent = s.pinned ? '★' : '☆'; pin.title = s.pinned ? 'Unpin' : 'Pin to top';
    const title = document.createElement('span');
    title.className = 'session-title'; title.textContent = s.title || 'Untitled';
    const move = document.createElement('button');
    move.className = 'session-move'; move.textContent = '📁'; move.title = 'Move to folder';
    const rename = document.createElement('button');
    rename.className = 'session-rename'; rename.textContent = '✎'; rename.title = 'Rename';
    const hide = document.createElement('button');
    hide.className = 'session-hide'; hide.textContent = '⊘'; hide.title = s.hidden ? 'Unhide chat' : 'Hide chat (tucked away — show via the sidebar footer)';
    const del = document.createElement('button');
    del.className = 'session-del'; del.textContent = '×'; del.title = 'Delete';
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
    item.appendChild(pin); item.appendChild(main); item.appendChild(move); item.appendChild(rename); item.appendChild(hide); item.appendChild(del);
    return item;
  }

  // Build a collapsible folder header row.
  function makeFolderRow(folder, count) {
    const row = document.createElement('div');
    row.className = 'folder-row' + (folder.collapsed ? ' collapsed' : '');
    row.dataset.folder = folder.id;
    const toggle = document.createElement('span');
    toggle.className = 'folder-toggle'; toggle.textContent = folder.collapsed ? '▸' : '▾';
    const name = document.createElement('span');
    name.className = 'folder-name'; name.textContent = folder.name || 'Folder';
    const cnt = document.createElement('span');
    cnt.className = 'folder-count'; cnt.textContent = count;
    const del = document.createElement('button');
    del.className = 'folder-del'; del.textContent = '×'; del.title = 'Delete folder (chats move to top level)';
    row.appendChild(toggle); row.appendChild(name); row.appendChild(cnt);
    const rename = document.createElement('button');
    rename.className = 'folder-rename'; rename.textContent = '✎'; rename.title = 'Rename folder';
    row.appendChild(rename); row.appendChild(del);
    return row;
  }

  // Floating popup to pick which folder a chat goes into.
  function showFolderMenu(chatId, anchor) {
    const old = document.querySelector('.folder-menu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.className = 'folder-menu';
    const none = document.createElement('div');
    none.className = 'folder-menu-item'; none.textContent = '— Top level —';
    none.addEventListener('click', () => { window.api.setSessionFolder(chatId, null).then(() => { menu.remove(); refresh(); }); });
    menu.appendChild(none);
    for (const fid of Object.keys(folders).sort((a, b) => (folders[a].name || '').localeCompare(folders[b].name || ''))) {
      const opt = document.createElement('div');
      opt.className = 'folder-menu-item'; opt.textContent = '📁 ' + (folders[fid].name || 'Folder');
      opt.addEventListener('click', () => { window.api.setSessionFolder(chatId, fid).then(() => { menu.remove(); refresh(); }); });
      menu.appendChild(opt);
    }
    const rect = anchor.getBoundingClientRect();
    const menuH = Math.min(260, (Object.keys(folders).length + 1) * 36 + 16);
    const flip = rect.bottom + menuH > window.innerHeight;   // not enough room below → open upward
    menu.style.top = (flip ? rect.top - menuH : rect.bottom) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => {   // dismiss on next outside click
      const handler = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', handler); } };
      document.addEventListener('click', handler);
    }, 0);
  }

  // Toggle a folder's expand/collapse locally — no full refresh, no sidebar flash.
  function toggleFolderLocal(fid) {
    if (!folders[fid]) return;
    folders[fid].collapsed = !folders[fid].collapsed;
    window.api.toggleFolder(fid, folders[fid].collapsed);
    const frow = $('sessionList').querySelector('.folder-row[data-folder="' + fid + '"]');
    if (!frow) return;
    frow.querySelector('.folder-toggle').textContent = folders[fid].collapsed ? '▸' : '▾';
    frow.classList.toggle('collapsed', folders[fid].collapsed);
    const fc = frow.nextElementSibling;
    if (fc && fc.classList.contains('folder-children')) fc.style.display = folders[fid].collapsed ? 'none' : '';
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
        title.className = 'session-title'; title.textContent = r.title || 'Untitled';
        const snip = document.createElement('div');
        snip.className = 'session-snip'; snip.textContent = r.snippet || '';
        item.appendChild(title); item.appendChild(snip);
        el.appendChild(item);
      }
      return;
    }
    try { folders = await window.api.loadFolders(); } catch (e) { folders = {}; }
    let list = [];
    try { list = await window.api.listSessions(); } catch (e) {}
    const hiddenCount = list.filter((s) => s.hidden).length;
    const visible = list.filter((s) => showHidden || !s.hidden);   // hidden chats stay out of the way until asked for
    list = visible;
    $('sidebar').classList.toggle('has-items', list.length > 0);
    // Partition: pinned (any folder) → foldered (non-pinned, by folder) → top-level (non-pinned, no folder).
    const pinned = list.filter((s) => s.pinned);
    const topLevel = list.filter((s) => !s.pinned && (!s.folder || !folders[s.folder]));
    const byFolder = {};
    for (const s of list) {
      if (!s.pinned && s.folder && folders[s.folder]) {
        (byFolder[s.folder] = byFolder[s.folder] || []).push(s);
      }
    }
    let grandTokens = 0;
    for (const s of list) if (s.usage) grandTokens += s.usage.tokens || 0;
    // Render: pinned → folders (collapsible) → top-level.
    for (const s of pinned) el.appendChild(makeItem(s, false));
    const fids = Object.keys(folders).sort((a, b) => (folders[a].name || '').localeCompare(folders[b].name || ''));
    for (const fid of fids) {
      el.appendChild(makeFolderRow(folders[fid], (byFolder[fid] || []).length));
      // Always render the children (in a wrapper div), just hide when collapsed — so toggling
      // open/close is instant without a full sidebar rebuild.
      const fc = document.createElement('div');
      fc.className = 'folder-children';
      fc.dataset.folder = fid;
      fc.style.display = folders[fid].collapsed ? 'none' : '';
      for (const s of (byFolder[fid] || [])) fc.appendChild(makeItem(s, true));
      el.appendChild(fc);
    }
    for (const s of topLevel) el.appendChild(makeItem(s, false));
    const foot = $('sidebarFoot');
    if (foot) {
      foot.replaceChildren();
      if (list.length) {
        const stats = document.createElement('span');
        stats.textContent = fmtTokens(grandTokens) + ' · ' + list.length + ' chat' + (list.length === 1 ? '' : 's');
        foot.appendChild(stats);
      }
      if (hiddenCount > 0) {
        const toggle = document.createElement('button');
        toggle.className = 'foot-toggle';
        toggle.textContent = (showHidden ? '▲ hide ' : '▼ ') + hiddenCount + ' hidden';
        toggle.title = showHidden ? 'Tuck the hidden chats away again' : 'Show hidden chats';
        toggle.addEventListener('click', () => { showHidden = !showHidden; refresh(); });
        foot.appendChild(toggle);
      }
    }
  }

  async function newChat() {
    currentId = null;
    currentTitle = null;
    // A new chat starts from the default instruction files + default generation settings.
    let rp = '', proj = '';
    try { rp = (await window.api.loadModes()).roleplay || ''; } catch (e) {}
    try { proj = (await window.api.loadProject()) || ''; } catch (e) {}
    Constellation.chat.setPrompts({ roleplay: rp, project: proj, systemFiles: [], projectFiles: [] });
    let gen = null;
    try { gen = cfgToGen(await window.api.loadConfig()); } catch (e) {}
    if (gen) Constellation.chat.setOptions(gen);   // don't inherit the previous chat's settings
    if (Constellation.chat.setDraft) Constellation.chat.setDraft('');
    currentLore = [];   // new chats start with lore off by default
    Constellation.chat.reset();
    applyLore();
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
    // Restore generation settings: start from GLOBAL Settings, then carry over only this chat's
    // model. Older snapshots froze thinking/effort/etc per-chat — whitelisting heals those chats
    // (e.g. ones stuck on effort "high") so what Settings says today is what every chat does.
    let gen = null;
    try { gen = cfgToGen(await window.api.loadConfig()); } catch (e) {}
    if (gen && s.gen && s.gen.model) gen.model = s.gen.model;
    currentLore = Array.isArray(s.lore) ? s.lore : [];
    Constellation.chat.loadSession(s.messages || [], system, project, gen, s.usage, s.systemFiles, s.projectFiles);
    applyLore();   // apply this chat's enabled lorebooks to retrieval
    // Restore this chat's saved draft (if any), and — if we arrived via search — jump to the match.
    try { const drafts = await window.api.loadDrafts(); if (Constellation.chat.setDraft) Constellation.chat.setDraft(drafts[id] || ''); } catch (e) {}
    close();
    refresh();
    if (searchQuery && Constellation.chat.scrollToMatch) Constellation.chat.scrollToMatch(searchQuery);
  }

  async function saveCurrent(messages, system, project, gen, usage, systemFiles, projectFiles) {
    try {
      const title = currentTitle || deriveTitle(messages);
      const res = await window.api.saveSession({ id: currentId, title, messages, system, project, systemFiles, projectFiles, gen, usage, lore: currentLore });
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

  // Inline-create a new folder: drop an input at the top of the list, Enter saves, Esc cancels.
  function startNewFolder() {
    const el = $('sessionList');
    if (el.querySelector('.folder-name-input')) return;   // one at a time
    const input = document.createElement('input');
    input.className = 'folder-name-input';
    input.placeholder = 'Folder name…';
    input.setAttribute('aria-label', 'Folder name');
    el.insertBefore(input, el.firstChild);
    input.focus();
    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (v) await window.api.saveFolder({ id: null, name: v });
      refresh();
    };
    const cancel = () => { if (done) return; done = true; refresh(); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  // Inline-rename a folder (double-click its name).
  function startFolderRename(frow, fid) {
    const nameEl = frow.querySelector('.folder-name');
    if (!nameEl || frow.querySelector('.folder-name-input')) return;
    const original = nameEl.textContent;
    const input = document.createElement('input');
    input.className = 'folder-name-input';
    input.value = original;
    input.setAttribute('aria-label', 'Folder name');
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (v && v !== original) await window.api.saveFolder({ id: fid, name: v });
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
      // Folder row: toggle expand/collapse (or delete).
      const frow = e.target.closest('.folder-row');
      if (frow) {
        e.stopPropagation();
        const fid = frow.dataset.folder;
        if (e.target.closest('.folder-del')) {
          window.api.deleteFolder(fid).then(() => { refresh(); if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Folder deleted — chats moved to top level'); });
        } else if (e.target.closest('.folder-rename')) {
          startFolderRename(frow, fid);
        } else {
          toggleFolderLocal(fid);
        }
        return;
      }
      // Session item: load / pin / move / rename / delete.
      const item = e.target.closest('.session-item');
      if (!item) return;
      const id = item.dataset.id;
      if (e.target.closest('.session-del')) {
        e.stopPropagation();
        window.api.deleteSession(id).then(() => { if (id === currentId) { currentId = null; Constellation.chat.reset(); } refresh(); });
      } else if (e.target.closest('.session-rename')) {
        e.stopPropagation(); startRename(item, id);
      } else if (e.target.closest('.session-pin')) {
        e.stopPropagation();
        const willPin = !item.classList.contains('pinned');
        window.api.setPinned(id, willPin).then(() => { refresh(); if (window.Constellation && window.Constellation.toast) window.Constellation.toast(willPin ? 'Pinned' : 'Unpinned'); });
      } else if (e.target.closest('.session-hide')) {
        e.stopPropagation();
        const willHide = !item.classList.contains('hidden-chat');
        window.api.setSessionHidden(id, willHide).then(() => {
          refresh();
          if (window.Constellation && window.Constellation.toast) window.Constellation.toast(willHide ? 'Chat hidden — reveal it from the sidebar footer' : 'Chat restored');
        });
      } else if (e.target.closest('.session-move')) {
        e.stopPropagation(); showFolderMenu(id, e.target.closest('.session-move'));
      } else { load(id); }
    });
    // Create a new folder.
    const nf = $('newFolder');
    if (nf) nf.addEventListener('click', startNewFolder);
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

  // ---- bookmarks (starred passages) ----
  // Toggle is keyed on chat+message, so tapping ☆ on an already-saved message removes it.
  async function toggleBookmark({ msgIndex, head, role }) {
    if (!currentId) return { bookmarked: false };
    try {
      const all = await window.api.loadBookmarks();
      const existing = all.find((b) => b.chatId === currentId && b.msgIndex === msgIndex);
      if (existing) { await window.api.removeBookmark(existing.id); return { bookmarked: false }; }
      await window.api.addBookmark({ chatId: currentId, chatTitle: currentTitle, msgIndex, head, role });
      return { bookmarked: true };
    } catch (e) { return { bookmarked: false }; }
  }
  async function bookmarksForCurrent() {
    if (!currentId) return [];
    try { return (await window.api.loadBookmarks()).filter((b) => b.chatId === currentId); } catch (e) { return []; }
  }

  // ---- per-chat lorebook selection ----
  // Apply the current chat's enabled lorebooks to retrieval (load their full data, hand to chat.js).
  async function applyLore() {
    if (!Constellation.chat || !Constellation.chat.setActiveLore) return;
    try {
      const map = await window.api.loadLorebooks() || {};
      Constellation.chat.setActiveLore(currentLore.map((id) => map[id]).filter(Boolean));
    } catch (e) {}
  }
  // Enable/disable a lorebook for the current chat (called from the Lorebook overlay checkboxes).
  function setLore(ids) {
    currentLore = Array.isArray(ids) ? ids.slice() : [];
    if (currentId) { try { window.api.setSessionLore(currentId, currentLore); } catch (e) {} }
    applyLore();
  }
  function getLore() { return currentLore; }

  return { init, saveCurrent, forkFrom, saveDraft, toggleBookmark, bookmarksForCurrent, setLore, getLore, open, close };
})();
