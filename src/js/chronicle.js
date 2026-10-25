// Chronicle — the reader's reference panel. A slim tab on the right edge pulls open a per-chat
// reference: "The story so far" (a faithful rolling summary) + TYPED durable facts grouped by
// kind (Characters / Places / Events / Threads / Status / Notes) with search and filters.
// Threads and Status supersede — a newer fact about the same entity replaces the old, which
// collapses into a per-row history toggle (a reference showing stale facts as equals lies).
// Facts carry jump-to-source (click the locator to scroll to the message they came from) and a
// promote action (→ prompt box / → the chat's lorebook — explicit, never automatic: nothing
// here is sent to the model otherwise). "Capture" reads only what's NEW; "Summarize" folds the
// new into the running summary; "Rebuild" wipes and re-reads the whole story.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.chronicle = (function () {
  const KINDS = [
    { id: 'character', label: 'Characters', hint: 'who they are — identity, traits, relationships' },
    { id: 'place', label: 'Places', hint: 'locations and travel' },
    { id: 'event', label: 'Events', hint: 'what happened — the beat sheet (history accumulates)' },
    { id: 'thread', label: 'Threads', hint: 'open loops — promises, secrets, goals, unresolved tension' },
    { id: 'status', label: 'Status', hint: 'current conditions — injuries, transformations, who knows what' },
    { id: 'note', label: 'Notes', hint: 'untyped facts and your own notes' },
  ];
  const SUPERSEDES = { thread: true, status: true };   // events are history; characters/places accumulate nuance

  let chatId = null, facts = [], seen = 0, summary = '', sumSeen = 0, busy = false;
  let rebuildArmed = false, rebuildTimer = null;
  let filterKind = '', query = '';
  let tab = null, panel = null, listEl = null, sumEl = null, capBtn = null, sumBtn = null, rebuildBtn = null;
  let progWrap = null, progFill = null, progLabel = null, modelSel = null, provSel = null, searchEl = null, chipsEl = null;

  // ---- model resolution: '' = the chat's current model (default), else any connection's model
  function chronicleModel() {
    if (modelSel && modelSel.value) return modelSel.value;
    return (window.Constellation.chat && window.Constellation.chat.getOptions && window.Constellation.chat.getOptions().model) || '';
  }
  // ---- provider resolution: '' = auto. Story prose trips some providers' filters
  // ("high risk"); an explicit pin routes chronicle jobs around them.
  function chronicleProvider() {
    return (provSel && provSel.value) || '';
  }
  async function fillModelSelect() {
    if (!modelSel) return;
    try {
      const conns = await window.api.loadConnections();
      const chatModel = (window.Constellation.chat && window.Constellation.chat.getOptions && window.Constellation.chat.getOptions().model) || '';
      const cur = modelSel.value;
      modelSel.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'model: this chat' + (chatModel ? ' (' + chatModel + ')' : '');
      modelSel.appendChild(opt);
      for (const c of (conns && conns.list) || []) {
        for (const m of (c.models || []) || []) {
          const o = document.createElement('option');
          o.value = m.id;
          o.textContent = c.name + ' · ' + m.id;
          modelSel.appendChild(o);
        }
      }
      modelSel.value = (cur && Array.from(modelSel.options).some((o) => o.value === cur)) ? cur : '';
      await fillProviderSelect();
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
  }
  async function fillProviderSelect() {
    if (!provSel) return;
    const prev = provSel.value;
    try {
      const route = await window.api.modelRoute(chronicleModel());
      provSel.replaceChildren();
      if (!route || !route.isOpenRouter) {
        provSel.hidden = true;
        provSel.value = '';
        return;
      }
      provSel.hidden = false;
      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = 'provider: auto';
      provSel.appendChild(auto);
      if (route.modelPin) {
        const o = document.createElement('option');
        o.value = route.modelPin;
        o.textContent = 'provider: ' + route.modelPin + ' (model default)';
        provSel.appendChild(o);
      }
      const cat = await window.api.openrouterEndpoints(chronicleModel(), false);
      for (const e of (cat && cat.endpoints) || []) {
        if (e.tag && !Array.from(provSel.options).some((o) => o.value === e.tag)) {
          const o = document.createElement('option');
          o.value = e.tag;
          o.textContent = 'provider: ' + e.tag + (e.quantization ? ' · ' + e.quantization : '');
          provSel.appendChild(o);
        }
      }
      provSel.value = (prev && Array.from(provSel.options).some((o) => o.value === prev)) ? prev : '';
    } catch (e) {
      provSel.hidden = true;
      console.warn('[constellation]', e && e.message || e);
    }
  }

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
    hint.textContent = 'Durable facts of this story — for you, the reader. Nothing here is sent to the model unless you promote it (→).';

    const actions = document.createElement('div');
    actions.className = 'chronicle-actions';
    capBtn = document.createElement('button');
    capBtn.className = 'btn chronicle-capture'; capBtn.type = 'button'; capBtn.textContent = '✦ Capture new';
    capBtn.title = 'Read what has happened since the last pass and record the durable facts';
    capBtn.addEventListener('click', function () { capture(false); });
    sumBtn = document.createElement('button');
    sumBtn.className = 'btn chronicle-summarize'; sumBtn.type = 'button'; sumBtn.textContent = '≡ Summarize';
    sumBtn.title = 'Fold the new story into the running summary ("the story so far")';
    sumBtn.addEventListener('click', summarize);
    rebuildBtn = document.createElement('button');
    rebuildBtn.className = 'btn ghost chronicle-rebuild'; rebuildBtn.type = 'button'; rebuildBtn.textContent = '↻ Rebuild';
    rebuildBtn.title = 'Clear this chronicle (facts + summary) and re-read the whole story from the beginning';
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
      rebuild();
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
    cancel.title = 'Stop — everything read so far is kept';
    cancel.addEventListener('click', function () { try { window.api.cancelChronicle(); } catch (e) { console.warn('[constellation]', e && e.message || e); } });
    progWrap.appendChild(cancel);
    const btnRow = document.createElement('div');
    btnRow.className = 'chronicle-btnrow';
    btnRow.appendChild(capBtn); btnRow.appendChild(sumBtn); btnRow.appendChild(rebuildBtn);
    modelSel = document.createElement('select');
    modelSel.className = 'chronicle-model';
    modelSel.title = 'Model for capture + summarize — defaults to whatever this chat runs on';
    modelSel.addEventListener('change', function () { fillProviderSelect(); persistGen(); });
    provSel = document.createElement('select');
    provSel.className = 'chronicle-model chronicle-provider';
    provSel.hidden = true;
    provSel.title = 'Provider route for chronicle jobs — some OpenRouter providers filter story text; pin a trusted one (auto = let OpenRouter route)';
    provSel.addEventListener('change', function () { persistGen(); });
    const note = document.createElement('input');
    note.className = 'chronicle-note'; note.type = 'text'; note.placeholder = '+ add your own note, Enter…';
    note.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && note.value.trim()) { add(note.value.trim(), 'note'); note.value = ''; }
    });
    actions.appendChild(btnRow); actions.appendChild(modelSel); actions.appendChild(provSel); actions.appendChild(progWrap); actions.appendChild(note);

    sumEl = document.createElement('div');
    sumEl.className = 'chronicle-summary';
    chipsEl = document.createElement('div');
    chipsEl.className = 'chronicle-chips';
    searchEl = document.createElement('input');
    searchEl.className = 'chronicle-search'; searchEl.type = 'text'; searchEl.placeholder = 'search facts…';
    searchEl.addEventListener('input', function () { query = searchEl.value.trim().toLowerCase(); renderFacts(); });
    listEl = document.createElement('div');
    listEl.className = 'chronicle-list';

    panel.appendChild(head); panel.appendChild(hint); panel.appendChild(actions);
    panel.appendChild(sumEl); panel.appendChild(chipsEl); panel.appendChild(searchEl); panel.appendChild(listEl);
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
    fillModelSelect();
    document.addEventListener('constellation:connections', function () { fillModelSelect(); });
  }

  function disarmRebuild() { rebuildArmed = false; if (rebuildBtn) { rebuildBtn.textContent = '↻ Rebuild'; rebuildBtn.classList.remove('warn'); } }
  function toggle() { panel.classList.contains('open') ? close() : open(); }
  function open() { ensureDom(); fillModelSelect(); panel.classList.add('open'); render(); }
  function close() { if (panel) panel.classList.remove('open'); }

  function persist() {
    if (!chatId) return;
    try { window.api.saveChronicle(chatId, facts, seen, summary, sumSeen); } catch (e) { console.warn('[constellation]', e && e.message || e); }
  }
  function persistGen() {
    // the model choice rides the chat's gen settings (like every other per-chat setting)
    try {
      const chat = window.Constellation.chat;
      if (chat && chat.setOptions) { chat.setOptions({ chronicleModel: chronicleModel(), chronicleProvider: chronicleProvider() }); if (chat.persist) chat.persist(); }
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
  }

  // ---- the running summary ("the story so far") — editable, like everything here
  function renderSummary() {
    if (!sumEl) return;
    sumEl.replaceChildren();
    const head = document.createElement('div');
    head.className = 'chronicle-section-head';
    head.textContent = 'The story so far';
    if (!summary) {
      const meta = document.createElement('em');
      meta.textContent = ' — Summarize condenses it';
      head.appendChild(meta);
    }
    sumEl.appendChild(head);
    const body = document.createElement('div');
    body.className = 'chronicle-summary-body' + (summary ? '' : ' empty');
    body.textContent = summary || '(no summary yet)';
    body.title = 'Click to edit';
    body.addEventListener('click', function () {
      if (body.querySelector('textarea')) return;
      const ta = document.createElement('textarea');
      ta.value = summary; ta.rows = 6;
      body.replaceChildren(ta); ta.focus();
      const done = function () { summary = ta.value.trim(); persist(); renderSummary(); };
      ta.addEventListener('blur', done);
      ta.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); renderSummary(); } });
    });
    sumEl.appendChild(body);
  }

  // ---- supersede merge: newer thread/status facts about the same entity REPLACE the old —
  // the superseded ones leave the list and live on in the new fact's history chain (prev).
  function mergeFacts(incoming) {
    const haveText = new Set(facts.map(function (f) { return (f.t || '').toLowerCase(); }));
    let added = 0;
    for (const inc of incoming) {
      if (!inc || !inc.t || !inc.t.trim()) continue;
      if (haveText.has(inc.t.toLowerCase())) continue;
      haveText.add(inc.t.toLowerCase());
      if (SUPERSEDES[inc.kind] && inc.who) {
        const who = inc.who.toLowerCase();
        const keep = [];
        let supersededAny = false;
        for (const f of facts) {
          if (SUPERSEDES[f.kind] && f.who && f.who.toLowerCase() === who) {
            inc.prev = (inc.prev || []).concat(f);   // the chain — history stays one toggle away
            supersededAny = true;
          } else keep.push(f);
        }
        if (supersededAny) { facts.length = 0; for (const k of keep) facts.push(k); inc.fresh = true; }
      }
      facts.push(inc);
      added++;
    }
    return added;
  }

  function visibleFacts() {
    let out = facts;
    if (filterKind) out = out.filter(function (f) { return f.kind === filterKind; });
    if (query) out = out.filter(function (f) { return ((f.t || '') + ' ' + (f.who || '')).toLowerCase().includes(query); });
    return out;
  }

  function renderChips() {
    if (!chipsEl) return;
    chipsEl.replaceChildren();
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'chronicle-chip' + (filterKind === '' ? ' on' : '');
    all.textContent = 'All · ' + facts.length;
    all.addEventListener('click', function () { filterKind = ''; render(); });
    chipsEl.appendChild(all);
    for (const k of KINDS) {
      const n = facts.filter(function (f) { return f.kind === k.id; }).length;
      if (!n) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chronicle-chip' + (filterKind === k.id ? ' on' : '');
      b.textContent = k.label + ' · ' + n;
      b.title = k.hint;
      b.addEventListener('click', function () { filterKind = (filterKind === k.id ? '' : k.id); render(); });
      chipsEl.appendChild(b);
    }
  }

  function renderFacts() {
    if (!listEl) return;
    listEl.replaceChildren();
    if (!chatId) {
      listEl.appendChild(emptyNote('Open a chat to keep its chronicle.'));
      return;
    }
    if (!facts.length) {
      listEl.appendChild(emptyNote('Nothing on record yet. Capture distills the durable facts — or add notes yourself.'));
      return;
    }
    const vis = visibleFacts();
    if (!vis.length) {
      listEl.appendChild(emptyNote(query ? 'No facts match "' + query + '".' : 'No facts in this group.'));
      return;
    }
    for (const k of KINDS) {
      const group = vis.filter(function (f) { return f.kind === k.id; });
      if (!group.length) continue;
      const head = document.createElement('div');
      head.className = 'chronicle-section-head';
      head.textContent = k.label;
      const meta = document.createElement('em');
      meta.textContent = ' — ' + k.hint;
      head.appendChild(meta);
      listEl.appendChild(head);
      for (const f of group) listEl.appendChild(factRow(f));
    }
  }

  function emptyNote(text) {
    const e = document.createElement('div');
    e.className = 'chronicle-empty';
    e.textContent = text;
    return e;
  }

  function factRow(f) {
    const row = document.createElement('div');
    row.className = 'chronicle-fact' + (f.fresh ? ' fresh' : '');
    const main = document.createElement('div');
    main.className = 'chronicle-fact-main';
    const t = document.createElement('span');
    t.className = 'chronicle-fact-text';
    t.textContent = (f.who ? f.who + ' — ' : '') + f.t;
    t.title = 'Click to edit';
    t.addEventListener('click', function () { editFact(f, t); });
    main.appendChild(t);
    // promote: explicitly move this fact to the model's side (prompt box or lorebook)
    const pro = document.createElement('button');
    pro.className = 'chronicle-fact-act'; pro.type = 'button'; pro.textContent = '→'; pro.title = 'Promote — put this fact in front of the model';
    pro.addEventListener('click', function (e) { e.stopPropagation(); promote(f, pro); });
    main.appendChild(pro);
    // jump to source — from is the index into the chat's messages (recentMessages order)
    if (Number.isInteger(f.from) && f.from >= 0) {
      const jump = document.createElement('button');
      jump.className = 'chronicle-fact-act'; jump.type = 'button'; jump.textContent = '⌖'; jump.title = 'Jump to where this happened';
      jump.addEventListener('click', function (e) {
        e.stopPropagation();
        const chat = window.Constellation.chat;
        if (chat && chat.scrollToMessage) chat.scrollToMessage(f.from);
        close();
      });
      main.appendChild(jump);
    }
    const del = document.createElement('button');
    del.className = 'chronicle-fact-del'; del.type = 'button'; del.textContent = '×'; del.title = 'Remove';
    del.addEventListener('click', function () {
      const i = facts.indexOf(f);
      if (i !== -1) { facts.splice(i, 1); persist(); render(); }
    });
    main.appendChild(del);
    row.appendChild(main);
    // superseded history: the chain lives under the current fact, one toggle away
    if (f.prev && f.prev.length) {
      const hist = document.createElement('button');
      hist.className = 'chronicle-hist-toggle'; hist.type = 'button';
      hist.textContent = '⟲ ' + f.prev.length + ' earlier' + (f.prev.length === 1 ? '' : ' states');
      hist.addEventListener('click', function () {
        const open = row.classList.toggle('hist-open');
        if (open) {
          for (const old of f.prev) {
            const r = document.createElement('div');
            r.className = 'chronicle-fact old';
            const s = document.createElement('span');
            s.className = 'chronicle-fact-text';
            s.textContent = (old.who ? old.who + ' — ' : '') + old.t;
            r.appendChild(s);
            row.appendChild(r);
          }
        } else {
          row.querySelectorAll('.chronicle-fact.old').forEach(function (n) { n.remove(); });
        }
      });
      row.appendChild(hist);
    }
    return row;
  }

  function editFact(f, t) {
    if (t.querySelector('.chronicle-edit')) return;
    const wrap = document.createElement('div');
    wrap.className = 'chronicle-edit';
    const ta = document.createElement('textarea');
    ta.value = f.t; ta.rows = 2;
    const kindSel = document.createElement('select');
    for (const k of KINDS) {
      const o = document.createElement('option');
      o.value = k.id; o.textContent = k.label;
      kindSel.appendChild(o);
    }
    kindSel.value = KINDS.some(function (k) { return k.id === f.kind; }) ? f.kind : 'note';
    wrap.appendChild(ta); wrap.appendChild(kindSel);
    t.replaceChildren(wrap); ta.focus();
    const done = function () {
      const v = ta.value.replace(/\s+/g, ' ').trim();
      if (v && v !== f.t) f.t = v;
      f.kind = kindSel.value;
      persist(); render();
    };
    ta.addEventListener('blur', done);
    ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(); } });
  }

  function promote(f, anchor) {
    const text = (f.who ? f.who + ' — ' : '') + f.t;
    const pop = document.createElement('div');
    pop.className = 'route-pop chronicle-promote';   // reuse the route popover shell
    const head = document.createElement('div');
    head.className = 'route-pop-head';
    head.textContent = 'Promote to the model';
    pop.appendChild(head);
    const mk = function (label, sub, fn) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'route-row';
      const l = document.createElement('span'); l.textContent = label; b.appendChild(l);
      const s = document.createElement('em'); s.textContent = sub; b.appendChild(s);
      b.addEventListener('click', function () { pop.remove(); fn(); });
      pop.appendChild(b);
    };
    mk('To the prompt box', 'paste the fact into your next message', function () {
      const input = document.getElementById('input');
      if (input) {
        input.value = (input.value ? input.value + '\n' : '') + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    });
    mk('To this chat\'s lorebook', 'a constant entry — rides every future send', async function () {
      try {
        const map = await window.api.loadLorebooks();
        const chat = window.Constellation.chat;
        const state = chat && chat.getState ? chat.getState() : {};
        const attached = Array.isArray(state.activeLore) ? state.activeLore : [];
        let bookId = attached[0];
        if (!bookId || !map[bookId]) {
          bookId = 'lb_chronicle_' + String(chatId || 'chat').replace(/[^a-z0-9_]/gi, '');
          if (!map[bookId]) map[bookId] = { id: bookId, name: 'Chronicle picks', entries: [] };
        }
        if (!map[bookId].entries.some(function (e) { return (e.content || '') === text; })) {
          map[bookId].entries.push({ id: 'cp' + Date.now().toString(36), enabled: true, keys: [], content: text, constant: true });
          await window.api.saveLorebooks(map);
        }
        if (chat && chat.setActiveLore) chat.setActiveLore([map[bookId]]);
        if (window.Constellation.sessions && window.Constellation.sessions.setLore) window.Constellation.sessions.setLore([bookId]);
        if (window.Constellation.toast) window.Constellation.toast('Filed into "' + map[bookId].name + '" (constant entry)');
      } catch (e) {
        if (window.Constellation.toast) window.Constellation.toast('Promote failed: ' + String(e.message || e).slice(0, 100), 9000);
      }
    });
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 320, Math.round(r.left))) + 'px';
    setTimeout(function () {
      const off = function (ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', off); } };
      document.addEventListener('mousedown', off);
    }, 0);
  }

  function add(text, kind) { facts.push({ t: text.slice(0, 400), kind: kind || 'note' }); persist(); render(); }

  function render() { ensureDom(); renderSummary(); renderChips(); renderFacts(); }

  function setBusy(v) {
    busy = v;
    if (capBtn) capBtn.disabled = v;
    if (sumBtn) sumBtn.disabled = v;
    if (rebuildBtn) rebuildBtn.disabled = v;
    if (capBtn) capBtn.classList.toggle('working', v);
    if (progWrap) {
      progWrap.classList.toggle('on', v);
      if (!v) { progFill.style.width = '0%'; progLabel.textContent = ''; }
    }
  }

  function storyTail(fromIdx) {
    const all = window.Constellation.chat && window.Constellation.chat.recentMessages ? window.Constellation.chat.recentMessages(100000) : [];
    return all.slice(fromIdx);
  }

  async function capture(rebuild) {
    if (busy || !chatId) return;
    const fresh = storyTail(rebuild ? 0 : seen);
    if (!fresh.length) {
      if (window.Constellation.toast) window.Constellation.toast('Chronicle is up to date — Rebuild re-reads the whole story');
      return;
    }
    if (rebuild) { facts = []; seen = 0; render(); persist(); }
    setBusy(true);
    if (progLabel) progLabel.textContent = 'reading… pass 1 of ?';
    try {
      const res = await window.api.captureChronicle(fresh, chronicleModel(), chronicleProvider());
      const added = mergeFacts((res && res.facts) || []);
      seen += (res && res.coveredMsgs) || 0;
      persist(); render();
      if (window.Constellation.toast) {
        if (res && res.complete === false) window.Constellation.toast('Capture stopped — ' + added + ' facts kept from what was read');
        else window.Constellation.toast(added ? added + (added === 1 ? ' fact' : ' facts') + ' recorded' : 'Nothing new to record');
      }
    } catch (e) {
      if (window.Constellation.toast) window.Constellation.toast('Capture failed: ' + String(e.message || e).slice(0, 120), 9000);
    } finally {
      setBusy(false);
    }
  }

  async function summarize() {
    if (busy || !chatId) return;
    const fresh = storyTail(sumSeen);
    if (!fresh.length) {
      if (window.Constellation.toast) window.Constellation.toast('Summary is up to date — Rebuild re-summarizes the whole story');
      return;
    }
    setBusy(true);
    if (progLabel) progLabel.textContent = 'summarizing… pass 1 of ?';
    try {
      const res = await window.api.summarizeChronicle(fresh, chronicleModel(), chronicleProvider(), summary);
      if (res && res.summary) summary = res.summary;
      sumSeen += (res && res.coveredMsgs) || 0;
      persist(); renderSummary();
      if (window.Constellation.toast) window.Constellation.toast(res && res.complete === false ? 'Summary stopped — kept what was folded in' : 'Summary updated');
    } catch (e) {
      if (window.Constellation.toast) window.Constellation.toast('Summarize failed: ' + String(e.message || e).slice(0, 120), 9000);
    } finally {
      setBusy(false);
    }
  }

  function rebuild() { capture(true); }

  async function setChat(id, gen) {
    chatId = id || null;
    facts = []; seen = 0; summary = ''; sumSeen = 0; filterKind = ''; query = '';
    if (chatId) {
      try {
        const r = await window.api.loadChronicle(chatId);
        facts = (r && r.facts) || []; seen = (r && r.seen) || 0;
        summary = (r && r.summary) || ''; sumSeen = (r && r.sumSeen) || 0;
      } catch (e) { console.warn('[constellation]', e && e.message || e); }
    }
    if (modelSel) {
      const gm = gen && gen.chronicleModel;
      modelSel.value = (gm && Array.from(modelSel.options).some(function (o) { return o.value === gm; })) ? gm : '';
      const gp = gen && gen.chronicleProvider;
      if (gp) await fillProviderSelect();
      if (provSel && gp) provSel.value = (Array.from(provSel.options).some(function (o) { return o.value === gp; })) ? gp : '';
    }
    render();
  }

  return { setChat: setChat, open: open, close: close, toggle: toggle };
})();
