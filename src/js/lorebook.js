// Lorebook overlay: a collection of titled lorebooks, each enabled per-chat.
// Each lorebook holds entries (keyword/constant, or no-keyword "smart" passages). Only lorebooks
// ticked for the CURRENT chat contribute context. Semantic matching (embeddings) is per-lorebook.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.lorebook = (function () {
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
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
      try { lorebooks = await window.api.saveLorebooks(lorebooks) || lorebooks; } catch (e) { console.warn('[constellation]', e && e.message || e); }
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

    // ---- the test bench: paste a hypothetical message (or run the live chat's recent
    // window) and see exactly which entries fire, which are suppressed, and why ----
    const bench = document.createElement('div'); bench.className = 'lore-bench';
    bench.appendChild(el('div', 'lore-bench-head', 'Test bench'));
    const benchText = document.createElement('textarea');
    benchText.className = 'lore-content'; benchText.rows = 2;
    benchText.placeholder = 'Paste a hypothetical message to test against this book — blank = use the current chat\'s recent messages';
    const benchRow = document.createElement('div'); benchRow.className = 'settings-actions';
    const benchRun = document.createElement('button'); benchRun.className = 'btn'; benchRun.type = 'button'; benchRun.textContent = 'Run bench';
    benchRow.appendChild(benchRun); bench.appendChild(benchText); bench.appendChild(benchRow);
    const benchOut = document.createElement('div'); benchOut.className = 'lore-bench-out';
    bench.appendChild(benchOut);
    benchRun.addEventListener('click', async () => {
      if (!(window.Constellation && window.Constellation.chat && window.Constellation.chat.loreBench)) return;
      benchRun.disabled = true; benchRun.textContent = 'Running…';
      try {
        const rep = await window.Constellation.chat.loreBench(benchText.value);
        benchOut.replaceChildren();
        const buckets = [
          ['Fired', (rep.entries || []).filter((r) => r.included && !r.cut), 'lore-bench-fired'],
          ['Cut by budget / priority', (rep.entries || []).filter((r) => r.cut), 'lore-bench-cut'],
          ['Suppressed / no match', (rep.entries || []).filter((r) => !r.included && !r.cut), 'lore-bench-sup'],
        ];
        let shown = 0;
        for (const [label, rows, cls] of buckets) {
          const b = document.createElement('div'); b.className = 'lore-bench-bucket ' + cls;
          b.appendChild(el('div', 'lore-bench-lbl', label + ' — ' + rows.length));
          for (const r of rows) {
            shown++;
            const line = document.createElement('div'); line.className = 'lore-bench-row';
            const bits = [r.title, r.how ? '(' + r.how + ')' : '', r.suppressed ? '— ' + r.suppressed : ''].filter(Boolean).join(' ');
            line.textContent = bits;
            line.title = r.preview || '';
            b.appendChild(line);
          }
          benchOut.appendChild(b);
        }
        if (!shown) benchOut.appendChild(el('div', 'preset-empty', 'Nothing fired. Type a message containing one of your trigger words and run again.'));
      } finally {
        benchRun.disabled = false; benchRun.textContent = 'Run bench';
      }
    });
    editor.appendChild(bench);

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

  // A single editable entry within lorebook s — collapsed to a one-line accordion row by
  // default (title · keys preview · badges), expanding to the full editor on click.
  function entryEl(s, e, i) {
    const row = document.createElement('div');
    row.className = 'lore-entry collapsed';
    const head = document.createElement('div'); head.className = 'lore-head';

    // ---- collapsed summary row ----
    const sum = document.createElement('button'); sum.type = 'button'; sum.className = 'lore-sum';
    const en = document.createElement('input');
    en.type = 'checkbox'; en.className = 'lore-cb'; en.checked = !!e.enabled; en.title = 'Enable this entry';
    en.addEventListener('change', () => { e.enabled = en.checked; scheduleSave(); });
    en.addEventListener('click', (ev) => ev.stopPropagation());
    const titleFor = () => {
      if (e.title && String(e.title).trim()) return String(e.title).trim();
      const h = /^#{1,6}\s+(.+)$/m.exec(String(e.content || ''));
      if (h) return h[1].trim();
      if ((e.keys || []).length) return String(e.keys[0]);
      return String(e.content || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Untitled entry';
    };
    const badges = () => {
      const b = [];
      if (e.constant) b.push('constant');
      if (parseInt(e.depth, 10) > 0) b.push('depth ' + parseInt(e.depth, 10));
      if (parseInt(e.priority, 10) && parseInt(e.priority, 10) !== 3) b.push('prio ' + e.priority);
      if (parseInt(e.linger, 10) > 0) b.push('linger ' + e.linger);
      if (parseInt(e.cooldown, 10) > 0) b.push('cooldown ' + e.cooldown);
      if (parseInt(e.scanDepth, 10) > 0) b.push('scan ' + e.scanDepth);
      if ((e.files || []).length) b.push((e.files || []).length + ' file' + ((e.files || []).length === 1 ? '' : 's'));
      return b;
    };
    const sumTitle = document.createElement('span'); sumTitle.className = 'lore-sum-title'; sumTitle.textContent = titleFor();
    const sumKeys = document.createElement('span'); sumKeys.className = 'lore-sum-keys';
    const sumKeysText = (e.keys || []).map((k) => k.trim()).filter(Boolean).join(', ');
    sumKeys.textContent = sumKeysText ? sumKeysText : (String(e.content || '').includes('[[') ? '[[pickups]]' : 'smart — scored per passage');
    sumKeys.title = sumKeys.textContent;
    const sumBadges = document.createElement('span'); sumBadges.className = 'lore-sum-badges'; sumBadges.textContent = badges().join(' · ');
    sum.appendChild(en); sum.appendChild(sumTitle); sum.appendChild(sumKeys); sum.appendChild(sumBadges);
    const chev = document.createElement('span'); chev.className = 'lore-chev'; chev.textContent = '▾';
    sum.appendChild(chev);

    // ---- expanded editor ----
    const body = document.createElement('div'); body.className = 'lore-body';
    const titleRow = document.createElement('div'); titleRow.className = 'lore-head';
    const titleLbl = document.createElement('span'); titleLbl.className = 'lore-key-lbl'; titleLbl.textContent = 'Title';
    const title = document.createElement('input');
    title.type = 'text'; title.className = 'lore-title'; title.value = e.title || '';
    title.placeholder = 'optional — shown in the collapsed row and the bench';
    title.addEventListener('input', () => { e.title = title.value; sumTitle.textContent = titleFor(); scheduleSave(); });
    titleRow.appendChild(titleLbl); titleRow.appendChild(title);

    const keyRow = document.createElement('div'); keyRow.className = 'lore-head';
    const keyLbl = document.createElement('span'); keyLbl.className = 'lore-key-lbl'; keyLbl.textContent = 'Trigger words';
    const keys = document.createElement('input');
    keys.type = 'text'; keys.className = 'lore-keys'; keys.value = (e.keys || []).join(', ');
    keys.placeholder = 'comma = any · +key = must also match · -key = exclude · [[pickups]] in prose count too';
    keys.title = 'Plain keys fire on any match. "+key" must also be present. "-key" suppresses the entry when present. Blank = pull only the matching passage (best for big docs).';
    keys.addEventListener('input', () => { e.keys = String(keys.value).split(',').map((x) => x.trim()).filter(Boolean); sumKeys.textContent = (e.keys || []).join(', ') || (String(e.content || '').includes('[[') ? '[[pickups]]' : 'smart — scored per passage'); scheduleSave(); });
    const del = document.createElement('button');
    del.className = 'lore-del'; del.type = 'button'; del.title = 'Delete entry'; del.textContent = '×';
    del.addEventListener('click', () => { s.entries.splice(i, 1); render(); scheduleSave(); if (window.Constellation.toast) window.Constellation.toast('Entry deleted'); });
    keyRow.appendChild(keyLbl); keyRow.appendChild(keys); keyRow.appendChild(del);

    const content = document.createElement('textarea');
    content.className = 'lore-content'; content.rows = 3; content.value = e.content || '';
    content.placeholder = 'The world context to inject when a keyword appears… [[wrap words]] to make them trigger keys inline.';
    content.addEventListener('input', () => { e.content = content.value; scheduleSave(); });

    // Highlight-to-key: wrap the textarea selection in [[...]] (or insert [[ ]] at the caret).
    const pickBtn = document.createElement('button');
    pickBtn.className = 'btn lore-addfile'; pickBtn.type = 'button'; pickBtn.textContent = '⟦selection → key⟧';
    pickBtn.title = 'Wrap the selected text in [[ ]] so it becomes a trigger key inline (aliases after a |)';
    pickBtn.addEventListener('click', () => {
      const s0 = content.selectionStart, e0 = content.selectionEnd;
      const sel = content.value.slice(s0, e0);
      const wrap = sel ? '[[' + sel + ']]' : '[[' + ']]';
      content.value = content.value.slice(0, s0) + wrap + content.value.slice(e0);
      e.content = content.value; scheduleSave();
      content.focus();
      content.setSelectionRange(s0 + 2, s0 + 2 + (sel ? sel.length : 0));
    });

    // Split-by-headings: one markdown section per entry, header → title + key.
    const splitBtn = document.createElement('button');
    splitBtn.className = 'btn lore-addfile'; splitBtn.type = 'button'; splitBtn.textContent = '⤓ Split by headings';
    splitBtn.title = 'Split this entry into one entry per # / ## / ### section — each titled by its heading, with the heading as a trigger key';
    splitBtn.addEventListener('click', () => {
      const text = String(e.content || '');
      const marks = [];
      for (const m of text.matchAll(/^#{1,3}\s+(.+)$/gm)) marks.push({ at: m.index, end: m.index + m[0].length, title: m[1].trim() });
      if (marks.length < 2) { if (window.Constellation.toast) window.Constellation.toast('No repeated headings to split on — this needs # / ## / ### section headers'); return; }
      const sections = [];
      for (let k = 0; k < marks.length; k++) {
        const from = marks[k].end, to = k + 1 < marks.length ? marks[k + 1].at : text.length;
        sections.push({ title: marks[k].title, body: (text.slice(from, to) || '').trim() });
      }
      if (marks[0].at > 0) {
        const pre = text.slice(0, marks[0].at).trim();
        if (pre) sections.unshift({ title: e.title || 'Introduction', body: pre, keepKeys: true });
      }
      const newEntries = sections.map((sec, k) => ({
        id: 'l_' + Date.now() + '_' + k + '_' + Math.floor(Math.random() * 1e6),
        enabled: e.enabled !== false,
        keys: sec.keepKeys ? (e.keys || []).slice() : [sec.title],
        title: sec.title,
        content: sec.body,
        constant: false,
        depth: e.depth,
        priority: e.priority,
        scanDepth: e.scanDepth,
        linger: e.linger,
        cooldown: e.cooldown,
      }));
      s.entries.splice(i, 1, ...newEntries);
      render(); scheduleSave();
      if (window.Constellation.toast) window.Constellation.toast('Split into ' + newEntries.length + ' entries');
    });

    // ---- control strip: priority · scan depth · linger · cooldown · depth · constant ----
    const strip = document.createElement('div'); strip.className = 'lore-strip';
    const mkNum = (label, field, min, max, ph) => {
      const w = document.createElement('label'); w.className = 'lore-ctl';
      const l = document.createElement('span'); l.textContent = label; l.title = ph;
      const n = document.createElement('input');
      n.type = 'number'; n.min = String(min); n.max = String(max); n.step = '1';
      n.value = e[field] != null && e[field] !== '' ? String(e[field]) : '';
      n.placeholder = ph;
      n.addEventListener('input', () => { const v = parseInt(n.value, 10); e[field] = (isNaN(v) || v < min) ? undefined : Math.min(max, v); if (field === 'depth' || field === 'priority' || field === 'linger' || field === 'cooldown' || field === 'scanDepth') sumBadges.textContent = badges().join(' · '); scheduleSave(); });
      w.appendChild(l); w.appendChild(n);
      return w;
    };
    strip.appendChild(mkNum('Priority', 'priority', 1, 5, '1–5 — higher survives budget cuts first (3 = normal)'));
    strip.appendChild(mkNum('Depth', 'depth', 0, 12, '0 = system pile; N = injected N messages from the bottom'));
    strip.appendChild(mkNum('Scan msgs', 'scanDepth', 1, 16, 'How many recent messages this entry scans its keys against (blank = global default 4)'));
    strip.appendChild(mkNum('Linger', 'linger', 0, 99, 'Stay active N turns after the last match (blank = off)'));
    strip.appendChild(mkNum('Cooldown', 'cooldown', 0, 99, 'Rest N turns after firing (blank = off)'));
    const con = document.createElement('label'); con.className = 'lore-constant';
    const conCb = document.createElement('input'); conCb.type = 'checkbox'; conCb.checked = !!e.constant;
    conCb.addEventListener('change', () => { e.constant = conCb.checked; scheduleSave(); });
    con.appendChild(conCb); con.appendChild(document.createTextNode(' Always include'));

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

    // ---- accordion behavior ----
    sum.addEventListener('click', () => {
      const open = row.classList.toggle('collapsed');
      chev.textContent = open ? '▾' : '▴';
    });

    body.appendChild(titleRow); body.appendChild(keyRow); body.appendChild(content);
    body.appendChild(ftray); body.appendChild(addBtn);
    body.appendChild(pickBtn); body.appendChild(splitBtn);
    body.appendChild(strip);
    body.appendChild(con);
    head.appendChild(sum);
    row.appendChild(head); row.appendChild(body);
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

  return { init, open, close, load, render };
})();
