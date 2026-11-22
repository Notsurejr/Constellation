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
  let charMap = {};   // characterId -> card record (avatars for the sidebar badges)
  let showHidden = false;   // hidden chats stay tucked away until the footer toggle reveals them
  let sortMode = 'recent';   // recent | name | size — pinned always floats to the top

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
    const sc = $('sidebarScrim'); if (sc) sc.classList.add('open');
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
  function close() {
    $('sidebar').classList.remove('open');
    const sc = $('sidebarScrim'); if (sc) sc.classList.remove('open');
  }
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
    if (t >= 1000000) return (t / 1000000).toFixed(2) + 'M spent';
    if (t >= 1000) return (t / 1000).toFixed(1) + 'k spent';
    return t + ' spent';
  }

  // Build a single session-item row (reused for pinned, foldered, and top-level chats).
  // Monochrome inline icons (crisp at 15px, harmonize with every accent) — same
  // stroke language as the topbar SVGs: currentColor, 1.5px, round caps.
  var ICO = {
    folder: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M2 2l20 20"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
  };

  function makeItem(s, indented) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === currentId ? ' active' : '') + (s.pinned ? ' pinned' : '') + (indented ? ' indented' : '') + (s.hidden ? ' hidden-chat' : '') + (s.character ? ' char-chat' : '');
    item.dataset.id = s.id;
    // Flush-left first: title and meta own the row from the left edge. All actions live
    // in a right-anchored hover pill; a pinned chat also wears an accent rail + quiet star.
    const title = document.createElement('span');
    title.className = 'session-title'; title.textContent = s.title || 'Untitled';
    const main = document.createElement('div');
    main.className = 'session-main';
    main.appendChild(title);
    if (s.character) {   // character chats wear their face — a real portrait thumbnail as
      // the row's left child (spans title + meta lines), monogram fallback when no art.
      const chip = document.createElement('span');
      chip.className = 'session-char';
      chip.title = 'Character chat — ' + (s.character.name || '');
      const c = charMap[s.character.id];
      if (c && c.avatar) {
        const img = document.createElement('img');
        img.src = c.avatar; img.alt = ''; chip.appendChild(img);
      } else {
        chip.textContent = String(s.character.name || '?').slice(0, 1).toUpperCase();
      }
      item.appendChild(chip);
    }
    if ((s.parentId && s.parentTitle) || (s.usage && s.usage.tokens > 0)) {
      const meta = document.createElement('div');
      meta.className = 'session-meta';
      if (s.parentId && s.parentTitle) { const lin = document.createElement('span'); lin.className = 'session-lineage'; lin.textContent = '↳ ' + s.parentTitle; meta.appendChild(lin); }
      if (s.usage && s.usage.tokens > 0) { const u = document.createElement('span'); u.className = 'session-usage'; u.textContent = fmtTokens(s.usage.tokens); u.title = 'Lifetime tokens spent in this chat — every send re-carries the full history (this is what the API bills). The ◐ meter in the top bar shows the CURRENT context size instead.'; meta.appendChild(u); }
      main.appendChild(meta);
    }
    item.appendChild(main);
    const pin = document.createElement('button');
    pin.className = 'session-pin'; pin.textContent = s.pinned ? '★' : '☆'; pin.title = s.pinned ? 'Unpin' : 'Pin to top';
    const move = document.createElement('button');
    move.className = 'session-move'; move.innerHTML = ICO.folder; move.title = 'Move to folder';
    const rename = document.createElement('button');
    rename.className = 'session-rename'; rename.innerHTML = ICO.pencil; rename.title = 'Rename';
    const hide = document.createElement('button');
    hide.className = 'session-hide'; hide.innerHTML = ICO.eyeOff; hide.title = s.hidden ? 'Unhide chat' : 'Hide chat (tucked away — show via the sidebar footer)';
    const del = document.createElement('button');
    del.className = 'session-del'; del.textContent = '×'; del.title = 'Delete';
    const pill = document.createElement('div');
    pill.className = 'session-pill';
    pill.appendChild(pin); pill.appendChild(move); pill.appendChild(rename); pill.appendChild(hide); pill.appendChild(del);
    item.appendChild(pill);
    if (s.pinned) {
      const star = document.createElement('span');
      star.className = 'session-pinned-star'; star.textContent = '★'; star.title = 'Pinned';
      item.appendChild(star);
    }
    return item;
  }

  // Build a collapsible folder header row.
  function makeFolderRow(folder, count) {
    const row = document.createElement('div');
    row.className = 'folder-row' + (folder.collapsed ? ' collapsed' : '');
    row.dataset.folder = folder.id;
    const toggle = document.createElement('span');
    toggle.className = 'folder-toggle'; toggle.innerHTML = ICO.chevron;
    const name = document.createElement('span');
    name.className = 'folder-name'; name.textContent = folder.name || 'Folder';
    const cnt = document.createElement('span');
    cnt.className = 'folder-count'; cnt.textContent = count;
    const del = document.createElement('button');
    del.className = 'folder-del'; del.textContent = '×'; del.title = 'Delete folder (chats move to top level)';
    row.appendChild(toggle); row.appendChild(name); row.appendChild(cnt);
    const rename = document.createElement('button');
    rename.className = 'folder-rename'; rename.innerHTML = ICO.pencil; rename.title = 'Rename folder';
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
    try {   // character avatars for badges (cheap local read; absent API = no badges, never a failure)
      if (window.api && window.api.listCharacters) { const chars = await window.api.listCharacters(); charMap = {}; for (const c of chars) charMap[c.id] = c; }
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
    if (searchQuery) {
      let results = [];
      try { results = await window.api.searchSessions(searchQuery); } catch (e) { console.warn('[constellation]', e && e.message || e); }
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
    try { list = await window.api.listSessions(); } catch (e) { console.warn('[constellation]', e && e.message || e); }
    const hiddenCount = list.filter((s) => s.hidden).length;
    const visible = list.filter((s) => showHidden || !s.hidden);   // hidden chats stay out of the way until asked for
    list = visible;
    $('sidebar').classList.toggle('has-items', list.length > 0);
    // Partition: pinned (any folder) → foldered (non-pinned, by folder) → top-level (non-pinned, no folder).
    const sortFn = sortMode === 'name' ? (a, b) => String(a.title || '').localeCompare(String(b.title || ''))
                 : sortMode === 'size' ? (a, b) => ((b.usage && b.usage.tokens) || 0) - ((a.usage && a.usage.tokens) || 0)
                 : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
    const pinned = list.filter((s) => s.pinned).sort(sortFn);
    const topLevel = list.filter((s) => !s.pinned && (!s.folder || !folders[s.folder])).sort(sortFn);
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
      (byFolder[fid] || []).sort(sortFn);
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
    try { rp = (await window.api.loadModes()).roleplay || ''; } catch (e) { console.warn('[constellation]', e && e.message || e); }
    try { proj = (await window.api.loadProject()) || ''; } catch (e) { console.warn('[constellation]', e && e.message || e); }
    Constellation.chat.setPrompts({ roleplay: rp, project: proj, systemFiles: [], projectFiles: [] });
    let gen = null;
    try { gen = cfgToGen(await window.api.loadConfig()); } catch (e) { console.warn('[constellation]', e && e.message || e); }
    if (gen) Constellation.chat.setOptions(gen);   // don't inherit the previous chat's settings
    if (Constellation.chat.setDraft) Constellation.chat.setDraft('');
    currentLore = [];   // new chats start with lore off by default
    Constellation.chat.reset();
    if (window.Constellation.storySky) window.Constellation.storySky.setChat(null);   // unwritten sky
    if (window.Constellation.chronicle) window.Constellation.chronicle.setChat(null);
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
      try { system = (await window.api.loadModes()).roleplay || ''; } catch (e) { console.warn('[constellation]', e && e.message || e); }
      try { project = (await window.api.loadProject()) || ''; } catch (e) { console.warn('[constellation]', e && e.message || e); }
    }
    // Restore generation settings: start from GLOBAL Settings, then carry over only this chat's
    // model. Older snapshots froze thinking/effort/etc per-chat — whitelisting heals those chats
    // (e.g. ones stuck on effort "high") so what Settings says today is what every chat does.
    let gen = null;
    try { gen = cfgToGen(await window.api.loadConfig()); } catch (e) { console.warn('[constellation]', e && e.message || e); }
    if (gen && s.gen && s.gen.model) gen.model = s.gen.model;
    currentLore = Array.isArray(s.lore) ? s.lore : [];
    if (window.Constellation.storySky) window.Constellation.storySky.setChat(s.id, s.title || 'Untitled');   // this chat's constellation takes the margin
    if (window.Constellation.chronicle) window.Constellation.chronicle.setChat(s.id, s.gen);   // its chronicle is ready behind the right tab (gen carries the model choice)
    // Cast chats started before card re-injection existed have no stored blocks — lazily
    // compile them from the character record so the recall feature works on old chats too.
    if (!s.cardBlock && s.character && s.character.id) {
      try {
        const chars = await window.api.listCharacters();
        const c = (chars || []).find((x) => x.id === s.character.id);
        const cc = window.Constellation.cardcompile;
        if (c && cc) {
          const personas = await window.api.loadPersonas().catch(() => []);
          const pd = (personas || []).find((p) => p.default) || (personas || [])[0] || { name: 'You' };
          s.cardBlock = cc.characterBlock(c, pd.name);
        }
      } catch (e) { console.warn('[constellation]', e && e.message || e); }
    }
    Constellation.chat.loadSession(s.messages || [], system, project, gen, s.usage, s.systemFiles, s.projectFiles, s.character || null, s.projectFence || null, s.cardBlock || null, s.personaBlock || null, s.cardReinject || 0, s.cardReinjectAt || 0);
    applyLore();   // apply this chat's enabled lorebooks to retrieval
    // Restore this chat's saved draft (if any), and — if we arrived via search — jump to the match.
    try { const drafts = await window.api.loadDrafts(); if (Constellation.chat.setDraft) Constellation.chat.setDraft(drafts[id] || ''); } catch (e) { console.warn('[constellation]', e && e.message || e); }
    close();
    refresh();
    if (searchQuery && Constellation.chat.scrollToMatch) Constellation.chat.scrollToMatch(searchQuery);
  }

  // Routine autosave: update THIS chat's row in place (usage readout + recent-sort
  // position) instead of rebuilding the whole drawer on every send. Full refresh still
  // runs for anything structural — rename, create, delete, folder, pin, hidden — and as
  // the fallback whenever the row isn't there yet (first save of a brand-new chat) or
  // anything about the row is ambiguous.
  function refreshActiveRow(usage) {
    const el = $('sessionList');
    if (!el || !currentId) return false;
    const item = el.querySelector('.session-item[data-id="' + currentId + '"]');
    if (!item) return false;
    // lifetime-token readout under the title (created by the first full refresh once usage exists)
    if (usage && usage.tokens > 0) {
      const u = item.querySelector('.session-usage');
      if (!u) return false;
      u.textContent = fmtTokens(usage.tokens);
    }
    // recent sort: the active row moves to the front of its partition (pinned block,
    // its folder's children, or the top level). Name/size sorts keep their own order.
    if (sortMode === 'recent') {
      if (item.classList.contains('pinned')) {
        const firstPinned = Array.from(el.children).find((c) => c.classList && c.classList.contains('session-item') && c.classList.contains('pinned') && c !== item);
        if (firstPinned) el.insertBefore(item, firstPinned);
      } else {
        const fc = item.closest('.folder-children');
        if (fc) {
          const head = Array.from(fc.children).find((c) => c.classList && c.classList.contains('session-item') && c !== item);
          if (head) fc.insertBefore(item, head);
        } else {
          const head = Array.from(el.children).find((c) => c.classList && c.classList.contains('session-item') && !c.classList.contains('pinned') && c !== item);
          if (head) el.insertBefore(item, head);
        }
      }
    }
    return true;
  }
  // Quiet catch-up: after routine autosaves, a debounced full refresh restores the footer
  // totals and any ordering the row-update skipped. Skipped while a rename/folder input
  // or the folder menu is open — a rebuild would destroy in-progress edits.
  let listCatchUpTimer = null;
  function scheduleListCatchUp() {
    clearTimeout(listCatchUpTimer);
    listCatchUpTimer = setTimeout(() => {
      const typing = document.querySelector('.session-rename-input, .folder-name-input');
      const menu = document.querySelector('.folder-menu');
      if (typing || menu) { scheduleListCatchUp(); return; }
      refresh();
    }, 4000);
  }

  async function saveCurrent(messages, system, project, gen, usage, systemFiles, projectFiles, projectFenceTag, cardBlock, personaBlock, cardReinject, cardReinjectAt) {
    const _diagT0 = performance.now();
    try {
      const title = currentTitle || deriveTitle(messages);
      const res = await window.api.saveSession({ id: currentId, title, messages, system, project, systemFiles, projectFiles, gen, usage, lore: currentLore, projectFenceTag: projectFenceTag || null, cardBlock: cardBlock || null, personaBlock: personaBlock || null, cardReinject: cardReinject || 0, cardReinjectAt: cardReinjectAt || 0 });
      currentId = res.id;
      currentTitle = title;   // keep it across later auto-saves
      if (!refreshActiveRow(usage)) refresh();
      scheduleListCatchUp();
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
    finally { if (window.Constellation && window.Constellation.diag) window.Constellation.diag.span('save+sidebar', performance.now() - _diagT0); }
  }

  // Create a new chat that branches off a conversation prefix (carrying the parent's instructions
  // + settings). The parent chat on disk is untouched.
  async function forkFrom(bundle) {
    try {
      const title = (deriveTitle(bundle.messages) || 'Fork') + ' · fork';
      const parentId = currentId, parentTitle = currentTitle;   // remember where this fork branched from
      const res = await window.api.saveSession({ id: null, title, messages: bundle.messages, system: bundle.system, project: bundle.project, gen: bundle.gen, parentId, parentTitle, character: bundle.character || null, projectFenceTag: bundle.projectFenceTag || null, cardBlock: bundle.cardBlock || null, personaBlock: bundle.personaBlock || null, cardReinject: bundle.cardReinject || 0, cardReinjectAt: bundle.cardReinjectAt || 0 });   // cast forks keep the card (badge + macro eligibility)
      await load(res.id);   // create + switch into the new fork
      // The fork inherits the parent chronicle (facts + read-position + summary) — a fork
      // mid-story must not silently lose the reader reference it branched with.
      if (parentId) {
        try {
          const chr = await window.api.loadChronicle(parentId);
          if (chr && (chr.facts || []).length) await window.api.saveChronicle(res.id, chr.facts, chr.seen, chr.summary, chr.sumSeen);
        } catch (e) { console.warn('[constellation]', e && e.message || e); }
      }
      if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Forked to "' + title + '"');
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
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
        try { await window.api.renameSession(id, v); } catch (e) { console.warn('[constellation]', e && e.message || e); }
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
    initImport();   // ⤓ Import chat button + sidebar drag-drop routing
    const scrim = $('sidebarScrim'); if (scrim) scrim.addEventListener('click', close);

    // Click anywhere outside the drawer (and not on the ☰ toggle) to close it.
    document.addEventListener('click', (e) => {
      if (!$('sidebar').classList.contains('open')) return;
      if (e.target.closest('#sidebar')) return;
      if (e.target.closest('#sidebarToggle')) return;
      close();
    });
    const sortSel = $('sidebarSort');
    if (sortSel) sortSel.addEventListener('change', async () => {
      sortMode = sortSel.value;
      try { await window.api.saveConfig({ sidebar_sort: sortMode }); } catch (e) { console.warn('[constellation]', e && e.message || e); }
      refresh();
    });
    (async () => { try { const cfg = await window.api.loadConfig(); if (cfg && cfg.sidebarSort) { sortMode = cfg.sidebarSort; sortSel.value = sortMode; } } catch (e) { console.warn('[constellation]', e && e.message || e); } })();
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
      try { window.api.saveDraft(currentId, text); } catch (e) { console.warn('[constellation]', e && e.message || e); }
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
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
  }
  // Enable/disable a lorebook for the current chat (called from the Lorebook overlay checkboxes).
  function setLore(ids) {
    currentLore = Array.isArray(ids) ? ids.slice() : [];
    if (currentId) { try { window.api.setSessionLore(currentId, currentLore); } catch (e) { console.warn('[constellation]', e && e.message || e); } }
    applyLore();
  }
  function getLore() { return currentLore; }

  // ---- Chat Importer (sidebar entry + drag-drop + preview modal) ----
  // Parsing lives in Constellation.chatimport (pure, unit-tested); this layer only reads
  // files, renders the preview with textContent, and saves through the normal sessions:save
  // path. DnD routing: prompt-box drops stay attachments (chat.js); sidebar drops and the
  // ⤓ button route here; chat-area drops route here only for detected chat formats.
  let importSeq = 0;
  const IMPORT = { overlay: null, filename: '', rawText: '', parsed: null, selected: new Set(), opts: {}, allowAttach: false, rawFiles: null, search: '' };

  function importToast(msg) { if (window.Constellation && window.Constellation.toast) window.Constellation.toast(msg); }

  // Sniff a dropped/staged file: 'card' (chara_card_v2 → The Cast), 'chat' (recognized
  // export → importer), or null (not a chat/card — caller decides: attachments or ignore).
  function sniffFile(filename, text) {
    const ci = window.Constellation.chatimport;
    if (!ci) return null;
    if (/\.json$/i.test(filename)) {
      try { if (ci.isCharacterCard(JSON.parse(text))) return 'card'; } catch (e) {}
    }
    const fmt = ci.detect(text);
    if (fmt && fmt !== 'unknown' && fmt !== 'card') return 'chat';
    return null;
  }

  async function routeDroppedFiles(files, source) {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    let attached = 0, imported = 0;
    for (const f of arr) {
      const name = f.name || '';
      if (/\.(json|jsonl|md|txt)$/i.test(name)) {
        let text = '';
        try { text = await f.text(); } catch (e) { /* fall through to attachments */ }
        const sniff = text ? sniffFile(name, text) : null;
        if (sniff === 'card') {
          try {
            const buf = new Uint8Array(await f.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
            const r = await window.api.importCharacterDrops([{ name, b64: btoa(bin) }]);
            if (r && r.some((x) => x.ok)) importToast('Card added to The Cast');
            continue;
          } catch (e) {
            console.warn('[constellation] card drop import failed:', e && e.message || e);
            /* fall through to attachments */
          }
        }
        if (sniff === 'chat') {
          // Chat-area routing (the prompt box itself never routes here): an IN-USE chat
          // (has model replies) treats the export as context — attach directly with a
          // ping; a FRESH chat (no model replies yet) opens the preview modal, with
          // attach-instead still available as the escape hatch. Sidebar drops always
          // open the modal — that entry point exists to import.
          const inUse = document.querySelectorAll('#messages .msg.assistant').length > 0;
          if (source === 'chat' && inUse) {
            if (window.Constellation.chat && window.Constellation.chat.attachFiles) {
              window.Constellation.chat.attachFiles([f]);
              importToast('Recognized a chat export — attached to this chat (⤓ Import chat converts it)');
            }
            continue;
          }
          openImportModal(name, text, { allowAttach: source === 'chat', rawFiles: source === 'chat' ? [f] : null });
          imported++;
          continue;
        }
        // unrecognized: sidebar imports fall open into Custom markers; chat-area keeps it as an attachment
        if (source === 'sidebar' && /\.(md|txt)$/i.test(name)) {
          openImportModal(name, text, { unknown: true });
          imported++;
          continue;
        }
      }
      if (source === 'chat') {
        if (window.Constellation.chat && window.Constellation.chat.attachFiles) window.Constellation.chat.attachFiles([f]);
        attached++;
      } else {
        importToast('"' + name.slice(0, 40) + '" is not a recognized chat export');
      }
    }
    if (imported > 1) importToast('Opening the last import — ' + imported + ' file' + (imported === 1 ? '' : 's') + ' queued in the modal history');
  }

  function openImportModal(filename, text, o) {
    o = o || {};
    const ci = window.Constellation.chatimport;
    if (!ci) return;
    closeImportModal();
    IMPORT.filename = filename;
    IMPORT.rawText = text;
    IMPORT.allowAttach = !!o.allowAttach;
    IMPORT.rawFiles = o.rawFiles || null;
    IMPORT.opts = { includeThinking: false, includeSystem: true, swapRoles: false, userMarker: '', assistantMarker: '', thinkMarker: '' };
    IMPORT.selected = new Set();
    IMPORT.search = '';
    IMPORT.parsed = (o.unknown || !ci.detect(text)) ? { format: 'unknown', multiChat: false, chats: [], rawPreview: ci.estimateTokens ? text.split(/\r?\n/).slice(0, 25).join('\n') : '' } : ci.parse(text, IMPORT.opts);
    buildImportOverlay();
  }

  function closeImportModal() {
    if (IMPORT.overlay) { IMPORT.overlay.remove(); IMPORT.overlay = null; }
    document.removeEventListener('mousedown', importDismiss, true);
  }
  function importDismiss(e) { if (IMPORT.overlay && !IMPORT.overlay.contains(e.target)) closeImportModal(); }

  function reparse() {
    const ci = window.Constellation.chatimport;
    if (IMPORT.opts.userMarker || IMPORT.opts.assistantMarker) {
      IMPORT.parsed = ci.parseCustom(IMPORT.rawText, IMPORT.opts);
    } else if (IMPORT.parsed.format === 'unknown') {
      IMPORT.parsed = { format: 'unknown', multiChat: false, chats: [], rawPreview: IMPORT.rawText.split(/\r?\n/).slice(0, 25).join('\n') };
    } else {
      IMPORT.parsed = ci.parse(IMPORT.rawText, IMPORT.opts);
    }
  }

  function buildImportOverlay() {
    const ov = document.createElement('div');
    ov.className = 'import-overlay';
    const panel = document.createElement('div');
    panel.className = 'import-panel';
    const head = document.createElement('div');
    head.className = 'import-head';
    head.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '⤓ Import chat' }));
    const fname = document.createElement('div');
    fname.className = 'import-filename';
    fname.textContent = IMPORT.filename;
    head.appendChild(fname);
    const x = document.createElement('button');
    x.className = 'import-close';
    x.textContent = '×'; x.title = 'Close';
    x.addEventListener('click', closeImportModal);
    head.appendChild(x);
    panel.appendChild(head);
    const body = document.createElement('div');
    body.className = 'import-body';
    panel.appendChild(body);
    ov.appendChild(panel);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeImportModal(); });
    document.addEventListener('mousedown', importDismiss, true);
    const foot = document.createElement('div');
    foot.className = 'import-foot';
    const attach = document.createElement('button');
    attach.type = 'button'; attach.className = 'import-btn';
    attach.textContent = 'Attach to current chat instead';
    attach.title = 'Skip importing — add this file to the current chat as an attachment';
    attach.addEventListener('click', attachInstead);
    if (!IMPORT.allowAttach) attach.style.display = 'none';
    foot.appendChild(attach);
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    foot.appendChild(spacer);
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'import-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeImportModal);
    foot.appendChild(cancel);
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'import-btn primary import-go';
    go.addEventListener('click', () => confirmImport());
    foot.appendChild(go);
    panel.appendChild(foot);
    document.body.appendChild(ov);
    IMPORT.overlay = ov;
    renderImportBody(body);
  }

  function renderImportBody(body) {
    const ci = window.Constellation.chatimport;
    body.replaceChildren();
    const parsed = IMPORT.parsed;

    // format badge + raw peek for unknown formats
    const badgeRow = document.createElement('div');
    badgeRow.className = 'import-badge-row';
    const badge = document.createElement('span');
    badge.className = 'import-badge';
    badge.textContent = ci.formatLabel ? ci.formatLabel(parsed.format) : parsed.format;
    badge.dataset.format = parsed.format;   // the raw enum key rides along for tests/inspection
    badge.title = 'Detected format: ' + parsed.format;
    badgeRow.appendChild(badge);
    body.appendChild(badgeRow);
    if (parsed.format === 'unknown') {
      const peek = document.createElement('pre');
      peek.className = 'import-raw-peek';
      peek.textContent = parsed.rawPreview || IMPORT.rawText.split(/\r?\n/).slice(0, 25).join('\n');
      body.appendChild(peek);
    }

    // multi-chat checklist
    if (parsed.multiChat) {
      if (!IMPORT.selected.size) parsed.chats.forEach((c, i) => IMPORT.selected.add(i));
      const search = document.createElement('input');
      search.type = 'text'; search.className = 'import-search';
      search.placeholder = '🔍 Search chats…'; search.value = IMPORT.search;
      search.addEventListener('input', () => { IMPORT.search = search.value; renderImportBody(body); const s = body.querySelector('.import-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
      body.appendChild(search);
      const selRow = document.createElement('div');
      selRow.className = 'import-select-row';
      const all = document.createElement('button'); all.className = 'import-mini'; all.textContent = 'Select all';
      all.addEventListener('click', () => { parsed.chats.forEach((c, i) => { if (!IMPORT.search || (c.title || '').toLowerCase().includes(IMPORT.search.toLowerCase())) IMPORT.selected.add(i); }); renderImportBody(body); });
      const none = document.createElement('button'); none.className = 'import-mini'; none.textContent = 'Clear';
      none.addEventListener('click', () => { IMPORT.selected.clear(); renderImportBody(body); });
      selRow.appendChild(all); selRow.appendChild(none);
      const cnt = document.createElement('span'); cnt.className = 'import-count'; cnt.textContent = IMPORT.selected.size + ' of ' + parsed.chats.length + ' selected';
      selRow.appendChild(cnt);
      body.appendChild(selRow);
      const listEl = document.createElement('div');
      listEl.className = 'import-list';
      parsed.chats.forEach((c, i) => {
        if (IMPORT.search && !(c.title || '').toLowerCase().includes(IMPORT.search.toLowerCase())) return;
        const row = document.createElement('div');
        row.className = 'import-check-row' + (IMPORT.selected.has(i) ? ' selected' : '');
        const box = document.createElement('input');
        box.type = 'checkbox'; box.checked = IMPORT.selected.has(i);
        box.addEventListener('click', (e) => { e.stopPropagation(); if (box.checked) IMPORT.selected.add(i); else IMPORT.selected.delete(i); row.classList.toggle('selected', box.checked); updateCount(); });
        row.appendChild(box);
        const label = document.createElement('div');
        label.className = 'import-row-label';
        const t = document.createElement('div'); t.className = 'import-row-title'; t.textContent = c.title || 'Untitled';
        const meta = document.createElement('div'); meta.className = 'import-row-meta'; meta.textContent = (c.date ? c.date.slice(0, 10) + ' · ' : '') + c.count + ' messages';
        label.appendChild(t); label.appendChild(meta);
        row.appendChild(label);
        row.addEventListener('click', (e) => { if (e.target === box) return; IMPORT.selected.has(i) ? IMPORT.selected.delete(i) : IMPORT.selected.add(i); renderImportBody(body); });
        listEl.appendChild(row);
      });
      body.appendChild(listEl);
      function updateCount() { const el = body.querySelector('.import-count'); if (el) el.textContent = IMPORT.selected.size + ' of ' + parsed.chats.length + ' selected'; }
    }

    // single-chat preview: editable title, turn count, tokens, first 2–3 turns
    const chat = parsed.multiChat ? null : parsed.chats[0];
    if (chat && chat.turns) {
      const titleWrap = document.createElement('div');
      titleWrap.className = 'import-title-wrap';
      const micro = document.createElement('div');
      micro.className = 'import-microlabel';
      micro.textContent = 'Title';
      const titleEdit = document.createElement('input');
      titleEdit.type = 'text'; titleEdit.className = 'import-title-edit';
      titleEdit.value = chat.title || 'Imported chat';
      titleEdit.setAttribute('aria-label', 'Chat title');
      titleWrap.appendChild(micro);
      titleWrap.appendChild(titleEdit);
      body.appendChild(titleWrap);
      const stats = document.createElement('div');
      stats.className = 'import-stats';
      stats.textContent = chat.turns.length + ' turns · ~' + ci.estimateTokens(chat.turns.map((t) => t.content || '').join('\n\n')) + ' tokens (content)';
      body.appendChild(stats);
      const preview = document.createElement('div');
      preview.className = 'import-preview';
      chat.turns.slice(0, 3).forEach((t) => {
        const row = document.createElement('div');
        row.className = 'import-preview-turn role-' + t.role;
        const who = document.createElement('div');
        who.className = 'import-preview-role';
        who.textContent = (t.role === 'user' ? 'You' : (t.model || 'Assistant')) + (t.reasoning ? ' · ✦ thinking ' + (opts.includeThinking ? 'on' : 'stripped') : '');
        const txt = document.createElement('div');
        txt.className = 'import-preview-text';
        txt.textContent = String(t.content || '').slice(0, 400) + (String(t.content || '').length > 400 ? '…' : '');
        row.appendChild(who); row.appendChild(txt);
        preview.appendChild(row);
      });
      body.appendChild(preview);
    }
    // keep the footer button label in step with the selection
    const go = IMPORT.overlay.querySelector('.import-go');
    if (go) go.textContent = parsed.multiChat ? ('Import ' + IMPORT.selected.size + ' chat' + (IMPORT.selected.size === 1 ? '' : 's')) : 'Import chat';

    // warnings strip
    const allWarnings = [];
    (parsed.chats || []).forEach((c) => (c.warnings || []).forEach((w) => { if (!allWarnings.includes(w)) allWarnings.push(w); }));
    (parsed.warnings || []).forEach((w) => { if (!allWarnings.includes(w)) allWarnings.push(w); });
    if (allWarnings.length) {
      const strip = document.createElement('div');
      strip.className = 'import-warnings';
      allWarnings.forEach((w) => { const wl = document.createElement('div'); wl.className = 'import-warning'; wl.textContent = '· ' + w; strip.appendChild(wl); });
      body.appendChild(strip);
    }

    // custom markers (open by default for unknown formats)
    const markersOpen = parsed.format === 'unknown' || parsed.format === 'custom' || !!IMPORT.opts.userMarker || !!IMPORT.opts.assistantMarker;
    const det = document.createElement('details');
    det.className = 'import-markers' + (markersOpen ? ' open' : '');
    if (markersOpen) det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = 'Custom markers';
    det.appendChild(sum);
    const markerHint = document.createElement('div');
    markerHint.className = 'import-marker-hint';
    markerHint.textContent = 'Type the exact speaker lines your export uses — the preview re-parses live.';
    det.appendChild(markerHint);
    const mk = [['userMarker', 'User marker', IMPORT.opts.userMarker], ['assistantMarker', 'Assistant marker', IMPORT.opts.assistantMarker], ['thinkMarker', 'Thinking marker (optional)', IMPORT.opts.thinkMarker]];
    for (const [key, label, val] of mk) {
      const row = document.createElement('div');
      row.className = 'import-marker-row';
      const lab = document.createElement('label'); lab.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = val || ''; inp.placeholder = 'e.g. ## User';
      inp.addEventListener('input', () => {
        IMPORT.opts[key] = inp.value;
        clearTimeout(IMPORT._mkTimer);
        IMPORT._mkTimer = setTimeout(() => { reparse(); renderImportBody(body); }, 200);
      });
      row.appendChild(lab); row.appendChild(inp);
      det.appendChild(row);
    }
    body.appendChild(det);
    if (parsed.format === 'unknown' || parsed.format === 'custom') {
      const customNote = document.createElement('div');
      customNote.className = 'import-marker-hint';
      customNote.textContent = IMPORT.opts.userMarker || IMPORT.opts.assistantMarker ? 'Parsing with your markers — check the preview below.' : 'This file did not match a known exporter. Type its speaker markers above and the preview below parses live.';
      body.appendChild(customNote);
    }

    // options
    const optsRow = document.createElement('div');
    optsRow.className = 'import-opts';
    const mkCheck = (key, label, checked) => {
      const lab = document.createElement('label');
      lab.className = 'import-check';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = !!checked;
      box.addEventListener('change', () => { IMPORT.opts[key] = box.checked; reparse(); renderImportBody(body); });
      lab.appendChild(box);
      lab.appendChild(document.createTextNode(label));
      optsRow.appendChild(lab);
    };
    mkCheck('includeThinking', 'Include thinking blocks', IMPORT.opts.includeThinking);
    const hasSystem = (parsed.chats || []).some((c) => c.system);
    if (hasSystem) mkCheck('includeSystem', 'Include system prompt', IMPORT.opts.includeSystem !== false);
    const swap = document.createElement('button');
    swap.type = 'button'; swap.className = 'import-mini';
    swap.textContent = IMPORT.opts.swapRoles ? 'Roles swapped — swap back' : 'Swap roles';
    swap.addEventListener('click', () => { IMPORT.opts.swapRoles = !IMPORT.opts.swapRoles; reparse(); renderImportBody(body); });
    optsRow.appendChild(swap);
    body.appendChild(optsRow);
  }

  async function confirmImport() {
    const ci = window.Constellation.chatimport;
    const parsed = IMPORT.parsed;
    const selections = parsed.multiChat ? Array.from(IMPORT.selected).sort((a, b) => a - b) : [0];
    if (!selections.length) { importToast('Nothing selected'); return; }
    let cfgGen = null;
    try { cfgGen = cfgToGen(await window.api.loadConfig()); } catch (e) {}
    if (cfgGen && window.Constellation.chat && window.Constellation.chat.getOptions) {
      const o = window.Constellation.chat.getOptions();
      if (o && o.model) cfgGen.model = o.model;
    }
    const ids = [];
    let firstChat = null, firstTitle = null;
    for (const idx of selections) {
      const chat = parsed.multiChat ? ci.parseOne(IMPORT.rawText, idx, IMPORT.opts).chats[0] : parsed.chats[0];
      if (!chat || !chat.turns || !chat.turns.length) continue;
      const id = 'imp_' + Date.now().toString(36) + '_' + (++importSeq) + '_' + Math.floor(Math.random() * 1e6).toString(36);
      const title = (IMPORT.parsed.multiChat ? (chat.title || 'Imported chat ' + (idx + 1)) : (document.querySelector('.import-title-edit') ? document.querySelector('.import-title-edit').value.trim() : '') || chat.title) || 'Imported chat';
      const tokens = ci.estimateTokens(chat.turns.map((t) => t.content || '').join('\n\n'));
      const res = await window.api.saveSession({
        id, title, messages: chat.turns,
        system: chat.system || '', project: chat.project || '',
        systemFiles: [], projectFiles: [],
        gen: cfgGen || { model: 'mock-1' },
        usage: { tokens, requests: 0 },
        lore: [], character: chat.character || undefined,
        projectFenceTag: chat.projectFenceTag || null,
      });
      ids.push(res.id);
      if (!firstChat) { firstChat = res.id; firstTitle = title; }
    }
    if (!ids.length) { importToast('Nothing importable found'); return; }
    closeImportModal();
    refresh();   // one sidebar refresh after the whole batch
    if (ids.length === 1) importToast('Imported "' + firstTitle + '"');
    else importToast('Imported ' + ids.length + ' chats');
    await load(ids[0]);
  }

  function attachInstead() {
    if (IMPORT.rawFiles && window.Constellation.chat && window.Constellation.chat.attachFiles) {
      window.Constellation.chat.attachFiles(IMPORT.rawFiles);
      importToast('Attached to the current chat instead');
    }
    closeImportModal();
  }

  function openImportDialog() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.accept = '.json,.jsonl,.md,.txt';
    inp.addEventListener('change', () => { routeDroppedFiles(inp.files, 'sidebar'); });
    inp.click();
  }

  function initImport() {
    const btn = $('importChat');
    if (btn) btn.addEventListener('click', openImportDialog);
    const sidebar = $('sidebar');
    if (sidebar) {
      sidebar.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.types || [], (t) => t === 'Files')) { e.preventDefault(); sidebar.classList.add('drag-over'); }
      });
      sidebar.addEventListener('dragleave', (e) => { if (e.relatedTarget && sidebar.contains(e.relatedTarget)) return; sidebar.classList.remove('drag-over'); });
      sidebar.addEventListener('drop', async (e) => {
        sidebar.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          e.preventDefault(); e.stopPropagation();
          await routeDroppedFiles(e.dataTransfer.files, 'sidebar');
        }
      });
    }
  }

  return { init, initImport, routeDroppedFiles, sniffFile, importFromText: (name, text) => openImportModal(name, text, {}), openImportModal, closeImportModal, confirmImport, saveCurrent, forkFrom, saveDraft, load, toggleBookmark, bookmarksForCurrent, setLore, getLore, open, close, chatId: () => currentId, chatTitle: () => currentTitle };
})();

