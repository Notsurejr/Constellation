// Lorebook overlay: a collection of titled lorebooks, each enabled per-chat.
// Each lorebook holds entries (keyword/constant, or no-keyword "smart" passages). Only lorebooks
// ticked for the CURRENT chat contribute context. Semantic matching (embeddings) is per-lorebook.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.lorebook = (function () {
  function $(id) { return document.getElementById(id); }
  let lorebooks = {};          // id -> { id, name, entries, semantic }
  let selectedId = null;
  let saveTimer = null;
  let indexing = false, indexStatus = 'idle', reindexPending = false;

  function open() { render(); const o = $('lorebookOverlay'); if (o) o.classList.add('open'); }
  function close() { const o = $('lorebookOverlay'); if (o) o.classList.remove('open'); }
  function sel() { return lorebooks[selectedId] || null; }
  function activeIds() {
    const sess = window.Constellation.sessions;
    return (sess && sess.getLore) ? (sess.getLore() || []) : [];
  }

  async function load() {
    try { lorebooks = await window.api.loadLorebooks() || {}; } catch (e) { lorebooks = {}; }
    const ids = Object.keys(lorebooks);
    selectedId = ids.length ? ids.sort((a, b) => (lorebooks[a].name || '').localeCompare(lorebooks[b].name || ''))[0] : null;
    refreshActive();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { lorebooks = await window.api.saveLorebooks(lorebooks) || lorebooks; } catch (e) {}
      refreshActive();    // the active lorebooks' entry data may have changed → refresh chat's copy
      requestIndex();
    }, 400);
  }
  // Push the active lorebooks (those ticked for the current chat) to chat.js for retrieval.
  function refreshActive() {
    const chat = window.Constellation.chat;
    if (!chat || !chat.setActiveLore) return;
    chat.setActiveLore(activeIds().map((id) => lorebooks[id]).filter(Boolean));
  }

  function render() {
    // --- lorebook list (with per-chat enable checkboxes) ---
    const list = $('lorebookList');
    if (list) {
      list.replaceChildren();
      const ids = Object.keys(lorebooks).sort((a, b) => (lorebooks[a].name || '').localeCompare(lorebooks[b].name || ''));
      const on = activeIds();
      if (!ids.length) {
        const empty = document.createElement('div'); empty.className = 'preset-empty';
        empty.textContent = 'No lorebooks yet. Create one (e.g. "Warhammer 40k") and add your lore.';
        list.appendChild(empty);
      }
      for (const id of ids) {
        const lb = lorebooks[id];
        const row = document.createElement('div');
        row.className = 'lorebook-row' + (id === selectedId ? ' selected' : '');
        row.dataset.id = id;
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.className = 'lore-cb'; cb.checked = on.includes(id); cb.title = 'Use in this chat';
        cb.addEventListener('change', () => toggleActive(id, cb.checked));
        const name = document.createElement('span');
        name.className = 'lorebook-name'; name.textContent = lb.name || 'Untitled'; name.title = 'Edit entries';
        name.addEventListener('click', () => { selectedId = id; render(); });
        const cnt = document.createElement('span'); cnt.className = 'lorebook-count'; cnt.textContent = (lb.entries || []).length;
        const rn = document.createElement('button'); rn.className = 'lorebook-rename'; rn.type = 'button'; rn.title = 'Rename'; rn.textContent = '✎';
        rn.addEventListener('click', (e) => { e.stopPropagation(); startRename(id); });
        const del = document.createElement('button'); del.className = 'lorebook-del'; del.type = 'button'; del.title = 'Delete lorebook'; del.textContent = '×';
        del.addEventListener('click', (e) => { e.stopPropagation(); delLorebook(id); });
        row.appendChild(cb); row.appendChild(name); row.appendChild(cnt); row.appendChild(rn); row.appendChild(del);
        list.appendChild(row);
      }
    }
    // --- editor for the selected lorebook ---
    const editor = $('lorebookEditor');
    if (!editor) return;
    editor.replaceChildren();
    const s = sel();
    if (!s) {
      const empty = document.createElement('div'); empty.className = 'preset-empty';
      empty.textContent = 'Select a lorebook above to edit its entries, or create a new one.';
      editor.appendChild(empty);
      return;
    }
    const head = document.createElement('div'); head.className = 'lorebook-editor-head';
    const title = document.createElement('div'); title.className = 'lorebook-editor-title'; title.textContent = s.name || 'Untitled';
    const semLab = document.createElement('label'); semLab.className = 'field checkbox lore-sem';
    const sem = document.createElement('input'); sem.type = 'checkbox'; sem.checked = !!s.semantic;
    sem.addEventListener('change', () => { s.semantic = sem.checked; if (!s.semantic) clearVectors(s); scheduleSave(); });
    semLab.appendChild(sem); semLab.appendChild(document.createTextNode(' Semantic (match by meaning; slower)'));
    head.appendChild(title); head.appendChild(semLab);
    editor.appendChild(head);

    const ent = document.createElement('div'); ent.className = 'lore-entries';
    if (!(s.entries && s.entries.length)) {
      const empty = document.createElement('div'); empty.className = 'preset-empty';
      empty.textContent = 'No entries. Add one — leave trigger words blank for a big doc (only the relevant passage pulls in), or add trigger words for a specific fact.';
      ent.appendChild(empty);
    } else {
      s.entries.forEach((e, i) => ent.appendChild(entryEl(s, e, i)));
    }
    editor.appendChild(ent);

    const addWrap = document.createElement('div'); addWrap.className = 'settings-actions'; addWrap.style.justifyContent = 'flex-start';
    const add = document.createElement('button'); add.className = 'btn'; add.type = 'button'; add.textContent = '＋ Add entry';
    add.addEventListener('click', () => addEntry(s));
    addWrap.appendChild(add); editor.appendChild(addWrap);

    const status = document.createElement('div'); status.className = 'hint'; status.id = 'lorebookIndexStatus'; status.textContent = indexStatusText();
    editor.appendChild(status);
  }

  function indexStatusText() {
    const s = sel();
    if (!s || !s.semantic) return '';
    if (indexStatus === 'indexing') return 'Semantic index: building… (model loads on first run, ~130 MB)';
    if (indexStatus === 'ready') return 'Semantic index: ready ✓';
    if (indexStatus === 'failed') return 'Semantic index: unavailable — lexical (BM25) only.';
    return '';
  }
  function setIndexStatus(state) {
    indexStatus = state;
    const el = $('lorebookIndexStatus');
    if (el) el.textContent = indexStatusText();
  }

  function toggleActive(id, on) {
    const sess = window.Constellation.sessions;
    if (!sess || !sess.setLore) return;
    let ids = activeIds().filter((x) => x !== id);
    if (on) ids.push(id);
    sess.setLore(ids);   // updates current chat's active set + persists + refreshes chat
  }
  function newLorebook() {
    const id = 'lb_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
    lorebooks[id] = { id, name: 'New lorebook', entries: [], semantic: false };
    selectedId = id;
    scheduleSave();
    render();
    startRename(id);
  }
  function delLorebook(id) {
    delete lorebooks[id];
    if (selectedId === id) {
      const ids = Object.keys(lorebooks);
      selectedId = ids.length ? ids[0] : null;
    }
    const sess = window.Constellation.sessions;
    if (sess && sess.setLore && activeIds().includes(id)) sess.setLore(activeIds().filter((x) => x !== id));
    scheduleSave();
    render();
    if (window.Constellation.toast) window.Constellation.toast('Lorebook deleted');
  }
  function startRename(id) {
    const list = $('lorebookList'); if (!list) return;
    const row = list.querySelector('.lorebook-row[data-id="' + id + '"]'); if (!row) return;
    const nameEl = row.querySelector('.lorebook-name');
    if (!nameEl || row.querySelector('.lore-name-input')) return;
    const original = (lorebooks[id].name || 'Untitled');
    const input = document.createElement('input');
    input.className = 'lore-name-input'; input.value = original; input.setAttribute('aria-label', 'Lorebook name');
    nameEl.replaceWith(input); input.focus(); input.select();
    let done = false;
    const commit = () => { if (done) return; done = true; const v = input.value.trim(); if (v && v !== original) { lorebooks[id].name = v.slice(0, 60); scheduleSave(); } render(); };
    const cancel = () => { if (done) return; done = true; render(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
    input.addEventListener('blur', commit);
  }

  // A single editable entry (enabled + keywords + content + constant + files) within lorebook s.
  function entryEl(s, e, i) {
    const row = document.createElement('div');
    row.className = 'lore-entry';
    const head = document.createElement('div'); head.className = 'lore-head';
    const en = document.createElement('input');
    en.type = 'checkbox'; en.className = 'lore-cb'; en.checked = !!e.enabled; en.title = 'Enable this entry';
    en.addEventListener('change', () => { e.enabled = en.checked; scheduleSave(); });
    const keyLbl = document.createElement('span'); keyLbl.className = 'lore-key-lbl'; keyLbl.textContent = 'Trigger words';
    const keys = document.createElement('input');
    keys.type = 'text'; keys.className = 'lore-keys'; keys.value = (e.keys || []).join(', ');
    keys.placeholder = 'blank = pull only the matching passage (best for big docs)';
    keys.title = "Optional. If blank, only the relevant passage of this entry is pulled each turn.";
    keys.addEventListener('input', () => { e.keys = String(keys.value).split(',').map((x) => x.trim()).filter(Boolean); scheduleSave(); });
    const del = document.createElement('button');
    del.className = 'lore-del'; del.type = 'button'; del.title = 'Delete entry'; del.textContent = '×';
    del.addEventListener('click', () => { s.entries.splice(i, 1); render(); scheduleSave(); if (window.Constellation.toast) window.Constellation.toast('Entry deleted'); });
    head.appendChild(en); head.appendChild(keyLbl); head.appendChild(keys); head.appendChild(del);

    const content = document.createElement('textarea');
    content.className = 'lore-content'; content.rows = 3; content.value = e.content || '';
    content.placeholder = 'The world context to inject when a keyword appears…';
    content.addEventListener('input', () => { e.content = content.value; scheduleSave(); });

    const ftray = document.createElement('div'); ftray.className = 'attachments lore-files';
    const renderEntryFiles = () => {
      ftray.replaceChildren();
      const fs = e.files || [];
      for (const f of fs) {
        const chip = document.createElement('div'); chip.className = 'attach-chip';
        const ico = document.createElement('span'); ico.className = 'attach-ico'; ico.textContent = '📄';
        const nm = document.createElement('span'); nm.className = 'attach-name'; nm.textContent = f.name; nm.title = f.name;
        const x = document.createElement('button'); x.className = 'attach-x'; x.type = 'button'; x.title = 'Remove'; x.textContent = '×';
        x.addEventListener('click', () => { const k = fs.indexOf(f); if (k !== -1) { fs.splice(k, 1); e.files = fs; renderEntryFiles(); scheduleSave(); } });
        chip.appendChild(ico); chip.appendChild(nm); chip.appendChild(x);
        ftray.appendChild(chip);
      }
      ftray.hidden = fs.length === 0;
    };
    renderEntryFiles();
    const addBtn = document.createElement('button');
    addBtn.className = 'btn lore-addfile'; addBtn.type = 'button'; addBtn.textContent = '＋ Attach file';
    addBtn.title = 'Attach .md/.txt — contents are added when this entry fires';
    addBtn.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true; inp.accept = '.md,.markdown,.mdown,.txt,.text,.json,.csv,.log,.org,.rst';
      inp.addEventListener('change', () => {
        const arr = Array.from(inp.files || []);
        let remaining = arr.length;
        if (!remaining) return;
        const done = () => { if (--remaining === 0) { e.files = e.files || []; renderEntryFiles(); scheduleSave(); } };
        for (const file of arr) {
          const reader = new FileReader();
          reader.onload = () => { (e.files = e.files || []).push({ name: file.name, text: String(reader.result || '') }); done(); };
          reader.onerror = done;
          reader.readAsText(file);
        }
      });
      inp.click();
    });

    const foot = document.createElement('div'); foot.className = 'lore-foot';
    const con = document.createElement('label'); con.className = 'lore-constant';
    const conCb = document.createElement('input'); conCb.type = 'checkbox'; conCb.checked = !!e.constant;
    conCb.addEventListener('change', () => { e.constant = conCb.checked; scheduleSave(); });
    con.appendChild(conCb); con.appendChild(document.createTextNode(' Always include (no keyword needed)'));
    foot.appendChild(con);

    row.appendChild(head); row.appendChild(content); row.appendChild(ftray); row.appendChild(addBtn); row.appendChild(foot);
    return row;
  }
  function addEntry(s) {
    s.entries = s.entries || [];
    s.entries.push({ id: 'l_' + Date.now() + '_' + Math.floor(Math.random() * 1e9), keys: [], content: '', enabled: true, constant: false });
    render(); scheduleSave();
    const editor = $('lorebookEditor');
    const last = editor && editor.querySelector('.lore-entries .lore-entry:last-child .lore-keys');
    if (last) last.focus();
  }
  function clearVectors(s) { for (const e of (s.entries || [])) { e.chunks = undefined; e.chunkHash = undefined; } }

  // ---- semantic indexing (per selected lorebook; lazy + resilient — BM25 carries retrieval if it fails) ----
  // chunking + hashing live in the shared engine (same code the CLI uses)
  function chunkLore(text, maxChars) { return Constellation.engines.lore.chunkText(text, maxChars); }
  function simpleHash(s) { return Constellation.engines.simpleHash(s); }
  async function indexEntries() {
    if (indexing) return;
    const s = sel();
    if (!s || !s.semantic) { setIndexStatus('idle'); return; }
    if (!(window.api && window.api.embedTexts)) { setIndexStatus('unavailable'); return; }
    const smart = (s.entries || []).filter((e) => e && e.enabled && !e.constant && !(e.keys || []).length);
    const todos = [];
    for (const e of smart) {
      const source = [e.content || ''].concat((e.files || []).map((f) => '===== ' + f.name + ' =====\n' + (f.text || ''))).join('\n\n');
      const hash = simpleHash(source);
      if (e.chunkHash === hash && Array.isArray(e.chunks) && e.chunks.length && e.chunks[0].vector) continue;
      todos.push({ entry: e, hash, chunks: chunkLore(source) });
    }
    if (!todos.length) { setIndexStatus('ready'); return; }
    indexing = true; setIndexStatus('indexing');
    try {
      for (const job of todos) {
        const vecs = [];
        for (let i = 0; i < job.chunks.length; i += 32) {
          const res = await window.api.embedTexts(job.chunks.slice(i, i + 32));
          if (res && res.error) throw new Error(res.error);
          for (const v of res) vecs.push(v);
        }
        job.entry.chunks = job.chunks.map((text, i) => ({ text, vector: vecs[i] }));
        job.entry.chunkHash = job.hash;
      }
      lorebooks = await window.api.saveLorebooks(lorebooks) || lorebooks;
      refreshActive();
      setIndexStatus('ready');
    } catch (e) {
      setIndexStatus('failed');
    }
    indexing = false;
  }
  function requestIndex() {
    if (indexing) { reindexPending = true; return; }
    indexEntries().then(() => { if (reindexPending) { reindexPending = false; requestIndex(); } });
  }

  function init() {
    load();
    const btn = $('lorebookBtn'); if (btn) btn.addEventListener('click', open);
    const closeBtn = $('closeLorebook'); if (closeBtn) closeBtn.addEventListener('click', close);
    const o = $('lorebookOverlay');
    if (o) o.addEventListener('click', (ev) => { if (ev.target === o) close(); });
    const neu = $('lorebookNew'); if (neu) neu.addEventListener('click', newLorebook);
  }

  return { init, open, close };
})();
