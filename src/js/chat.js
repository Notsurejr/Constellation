// Cosmic chat that streams GLM replies, steered by the roleplay prompt + project instructions.
// Smoothly buffers streamed text, shows the model's "thinking" in a collapsible block,
// renders markdown in finished messages, supports editing your messages (and resending)
// and regenerating GLM's replies, and lets you attach markdown/text files as extra context.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.chat = (function () {
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const statusEl = document.getElementById('status');
  const jumpBtn = document.getElementById('jumpBottom');
  const ctxMeter = document.getElementById('ctxMeter');
  const topModel = document.getElementById('topModel');
  const compose = Constellation.compose;   // src/js/compose.js — pure request assembly (system, macros, fence, lore, trim)
  const sculpt = Constellation.sculpt;   // src/js/sculpt.js — per-message editing: edit/sculpt/think-edit/variants/fork
  const stream = Constellation.stream;     // src/js/stream.js — send→wire→reveal pipeline     // src/js/sculpt.js — per-message editing: edit/sculpt/think-edit/variants/fork

  let roleplayPrompt = '';
  let projectInstructions = '';
  let conversation = [];   // { role, content, files? } — conversation[0] is always the system message
  let busy = false;
  let currentCharacter = null;   // cast chats carry their card; macros fire ONLY in these chats
  let currentRequest = null;   // active stream id, so the Stop button can cancel it
  let lastRequest = null;      // the exact payload of the most recent send (for the ◐ inspector)
  let activePrefill = '';      // reasoning seed for THIS send only ("lead its thinking" drawer)
  let contextExact = null;     // exact token count from the GLM tokenizer (null = estimate shown)
  let bulkScroll = false;      // suppress per-message auto-scroll while bulk-rendering a chat
  let usage = { tokens: 0, requests: 0 };   // cumulative estimated tokens for the current chat
  let pendingFiles = [];   // [{ name, size, text }] queued attachments for the next send
  let opts = { model: 'glm-5.2', provider: '', chronicleModel: '', chronicleProvider: '', temperature: 0.8, topP: 0.95, maxTokens: 0, thinking: false, reasoningEffort: 'max', streamCps: 0, contextWindow: 0, teachEdits: false, preservedThinking: true, immersion: false, sendAttachments: true };
  let activeLore = [];   // lorebooks enabled for the current chat (each { entries, semantic }); sessions applies this
  let phraseBanRules = [];   // [{ re, replace }] tidied out of GLM's replies AFTER generation (the model never sees these)
  let systemFiles = [];   // [{name,text}] .md/.txt attached to this chat's system instructions (inlined into the system prompt)
  let projectFiles = [];  // [{name,text}] attached to this chat's project instructions

  function setStatus(text, cls, detail) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
    statusEl.classList.toggle('breathe', /^connected\b/.test(String(text)));   // gentle idle pulse
    // Errors stay visible after the toast fades: hover the pill to re-read what happened.
    statusEl.title = (cls === 'err' && detail) ? detail : '';
  }

  // Only auto-follow the stream when the reader is already near the bottom; if they've
  // scrolled up to read, leave their place alone and show a "jump to latest" button.
  function atBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  }
  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
  // Follow-the-stream with a hands-off guard. The 120px window must survive BOTH the native
  // ~21px keystroke nudge AND the ~100px of reveal between renders — so distance alone can't
  // tell "content grew under a stationary reader" (follow) from "reader scrolled up" (hands
  // off, immediately and permanently until they return to the bottom). The reader's own
  // scrollTop moving DOWN is the tell: growth leaves scrollTop untouched.
  let followTop = 0;
  function maybeScroll() {
    const dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (dist < 28) { scrollToBottom(); followTop = messagesEl.scrollTop; return; }   // truly at the bottom — follow
    if (messagesEl.scrollTop < followTop - 8) return;   // the reader pulled away mid-stream — hands off
    if (dist < 120) { scrollToBottom(); followTop = messagesEl.scrollTop; }
  }
  function updateJumpBtn() { if (jumpBtn) jumpBtn.hidden = atBottom(); }

  // (lastUserIndex now lives in Constellation.compose — one shared rule for composer + meter.)

  // --- Scroll preservation across a reply's finish ---
  // Finishing mutates layout ABOVE the reader's line (final markdown re-render, code-block toolbars,
  // continue button), which yanks the viewport. captureScrollAnchor() records the tightest block
  // straddling the viewport's top edge (any message); restoreScrollAnchor() puts it back where it
  // was. Survives the streaming body's innerHTML replacement via a text-match fallback.
  const ANCHOR_BLOCKS = '.role, .think-block, .think-body, .body p, .body li, .body pre, .body h1, .body h2, .body h3, .body h4, .msg-meta, .body';
  function captureScrollAnchor() {
    const viewTop = messagesEl.getBoundingClientRect().top + 2;
    let best = null;
    for (const b of messagesEl.querySelectorAll(ANCHOR_BLOCKS)) {
      const r = b.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.bottom < viewTop || r.top > viewTop) continue;   // must straddle the viewport's top edge
      if (!best || r.height < best.h) best = { el: b, h: r.height, text: (b.textContent || '').trim().slice(0, 80), off: r.top - viewTop };
    }
    return best;
  }
  function restoreScrollAnchor(a) {
    if (!a) return;
    const viewTop = messagesEl.getBoundingClientRect().top + 2;
    let target = (a.el && a.el.isConnected) ? a.el : null;
    if (!target) {
      for (const b of messagesEl.querySelectorAll(ANCHOR_BLOCKS)) {
        if ((b.textContent || '').trim().slice(0, 80) === a.text && b.getBoundingClientRect().height > 0) { target = b; break; }
      }
    }
    if (target) messagesEl.scrollTop += (target.getBoundingClientRect().top - viewTop) - a.off;
  }

  // Reading-progress hairline down the right edge: how far through the chat you've scrolled.
  function updateReadProgress() {
    const rp = document.getElementById('readProgress');
    if (!rp) return;
    const max = messagesEl.scrollHeight - messagesEl.clientHeight;
    if (max <= 0) { rp.style.setProperty('--rp', '0%'); rp.style.opacity = '0'; return; }
    rp.style.setProperty('--rp', (messagesEl.scrollTop / max) * 100 + '%');
    rp.style.opacity = '';
  }

  // Word/char count for a message footer, from its visible text.
  function updateMeta(metaEl, text, edited) {
    if (!metaEl) return;
    const t = String(text || '').trim();
    const words = t ? t.split(/\s+/).filter(Boolean).length : 0;
    metaEl.replaceChildren();
    metaEl.textContent = words + ' words · ' + t.length + ' chars';
    if (edited) {
      const b = document.createElement('span');
      b.className = 'sculpted-tag';
      b.textContent = ' · ✎ sculpted';
      b.title = 'You edited this reply — the model\u2019s original is kept with the message';
      metaEl.appendChild(b);
    }
  }

  // Rough context-size estimate (chars/4 ≈ tokens) across the whole conversation.
  // Follows the send rules: excluded files never count, and when "send attachments" is off
  // only the newest user message's files do.
  function updateContextMeter() {
    if (!ctxMeter) return;
    const _diagT0 = performance.now();
    try {
    let lastUserIdx = -1;
    if (opts.sendAttachments === false) lastUserIdx = compose.lastUserIndex(conversation);
    let chars = 0;
    for (const m of conversation) {
      chars += (m.content || '').length;   // includes the system message (your instructions)
      if (m.files) {
        const i = conversation.indexOf(m);
        const suppressed = opts.sendAttachments === false && i !== lastUserIdx;
        if (!suppressed) for (const f of m.files) { if (!f.excluded) chars += (f.text || '').length; }
      }
      if (opts.thinking && m.reasoning) chars += (m.reasoning || '').length;   // preserved thinking
    }
    const total = Math.max(0, Math.round(chars / 4));
    const win = Number(opts.contextWindow) || 0;
    const trimming = win > 0 && total > win;
    const sent = trimming ? win : total;
    ctxMeter.hidden = false;
    ctxMeter.classList.remove('warm', 'hot');
    const warmAt = win > 0 ? Math.round(win * 0.5) : 30000;
    const hotAt = win > 0 ? Math.round(win * 0.9) : 100000;
    if (total >= hotAt) ctxMeter.classList.add('hot');
    else if (total >= warmAt) ctxMeter.classList.add('warm');
    const fmt = (t) => t >= 1000 ? (t / 1000).toFixed(1) + 'k' : String(t);
    if (contextExact != null) {
      ctxMeter.textContent = '◐ ' + contextExact.toLocaleString();
      ctxMeter.title = 'Exact context size (GLM tokenizer) — click to see exactly what was sent';
      return;
    }
    ctxMeter.textContent = trimming ? ('◐ ≈' + fmt(sent) + ' / ≈' + fmt(total)) : ('◐ ≈' + fmt(total));
    ctxMeter.title = (trimming ? ('Sending last ≈' + fmt(sent) + ' of ≈' + fmt(total) + ' tokens (context window on)') : ('Estimated conversation size (≈ until the tokenizer answers after a send)'))
                   + ' — click to see exactly what was sent';
    } finally {
      if (window.Constellation && window.Constellation.diag) window.Constellation.diag.span('context-meter', performance.now() - _diagT0);
    }
  }

  // Export this chat as Obsidian-readable Markdown. A small popover gathers the
  // options first — thinking blocks default from Settings, system prompt off by default.
  let exportPop = null;
  function closeExportPop() { if (exportPop) { exportPop.remove(); exportPop = null; } }
  async function exportChat() {
    const turns = conversation.filter((m) => m.role !== 'system');
    if (!turns.length) { if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Nothing to export yet'); return; }
    if (exportPop) { closeExportPop(); return; }
    let mdThinking = true;
    try { const cfg = await window.api.loadConfig(); mdThinking = cfg.mdThinking !== false; } catch (e) { console.warn('[constellation]', e && e.message || e); }
    const firstUser = turns.find((m) => m.role === 'user');
    const title = (firstUser ? firstUser.content : 'chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'chat';

    exportPop = document.createElement('div');
    exportPop.className = 'sigil-pop export-pop';
    const h = document.createElement('div'); h.className = 'export-pop-title'; h.textContent = 'Export as Markdown';
    exportPop.appendChild(h);

    const mkRow = (label, checked, hint) => {
      const row = document.createElement('label'); row.className = 'export-pop-row';
      const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!checked;
      const span = document.createElement('span');
      span.textContent = label;
      if (hint) { const em = document.createElement('em'); em.textContent = ' ' + hint; span.appendChild(em); }
      row.appendChild(box); row.appendChild(span);
      exportPop.appendChild(row);
      return box;
    };
    const thinkBox = mkRow('Thinking blocks', mdThinking, '— folded, click to open');
    const sysBox = mkRow('System prompt', false, '— folded at the top');

    const go = document.createElement('button'); go.className = 'btn'; go.type = 'button'; go.textContent = 'Export';
    exportPop.appendChild(go);
    document.body.appendChild(exportPop);
    const eb = document.getElementById('exportBtn');   // anchor under the ⤓ button
    if (eb) { const r = eb.getBoundingClientRect(); exportPop.style.left = Math.max(8, Math.min(window.innerWidth - 336, r.right - 320)) + 'px'; exportPop.style.top = (r.bottom + 8) + 'px'; }

    const dismiss = (ev) => { if (exportPop && !exportPop.contains(ev.target) && ev.target !== document.getElementById('exportBtn')) { closeExportPop(); document.removeEventListener('mousedown', dismiss); } };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);

    go.addEventListener('click', async () => {
      const payload = {
        title: title,
        messages: turns.map((m) => ({ role: m.role, content: m.content || '', reasoning: m.reasoning || '', edited: !!m.edited, orig: m.orig || '' })),
        model: opts.model,
        includeThinking: thinkBox.checked,
        includeSystem: sysBox.checked,
        system: sysBox.checked && conversation[0] && conversation[0].role === 'system' ? conversation[0].content : '',
      };
      closeExportPop();
      try {
        const r = await window.api.exportChatMarkdown(payload);
        if (r && r.ok && window.Constellation && window.Constellation.toast) window.Constellation.toast('Exported "' + title + '"');
        else if (r && r.error && window.Constellation && window.Constellation.toast) window.Constellation.toast('Export failed: ' + r.error);
      } catch (e) { console.warn('[constellation]', e && e.message || e); }
    });
  }

  // (filesBlock / immersionBlock / buildSystem now live in Constellation.compose —
  // buildSystem({ roleplayPrompt, systemFiles, projectFiles, immersion }).)

  // The project fence tag is PER-CHAT (your system instructions can reference it by name);
  // the lore fence tag is GLOBAL. Tags must be plain fence-safe words.
  const safeTag = (t, fallback) => /^[A-Za-z0-9_-]{1,40}$/.test(String(t || '').trim()) ? String(t).trim() : fallback;
  let projectFenceTag = 'project_instructions';
  // Card re-injection (cast chats): the compiled character/persona blocks re-enter the
  // stack at a chosen depth — the recall copy when the system-pile card "loses hold".
  let cardBlock = null, personaBlock = null, cardReinject = 0, cardReinjectAt = 0;

  function setPrompts({ roleplay, project, systemFiles: sFiles, projectFiles: pFiles, projectFenceTag: pTag, cardReinject: cRe, cardReinjectAt: cAt }) {
    if (roleplay !== undefined) roleplayPrompt = (roleplay || '').trim();
    if (project !== undefined) projectInstructions = (project || '').trim();
    if (sFiles !== undefined) systemFiles = Array.isArray(sFiles) ? sFiles : [];
    if (pFiles !== undefined) projectFiles = Array.isArray(pFiles) ? pFiles : [];
    if (pTag !== undefined) projectFenceTag = safeTag(pTag, 'project_instructions');
    if (cRe !== undefined) cardReinject = Math.max(0, Math.min(12, parseInt(cRe, 10) || 0));
    if (cAt !== undefined) cardReinjectAt = Math.max(0, Math.min(1000000, parseInt(cAt, 10) || 0));
    opts.projectFenceTag = projectFenceTag;
    opts.cardBlock = cardBlock; opts.personaBlock = personaBlock;
    opts.cardReinject = cardReinject; opts.cardReinjectAt = cardReinjectAt;
    const sys = compose.buildSystem({ roleplayPrompt: roleplayPrompt, systemFiles: systemFiles, projectFiles: projectFiles, immersion: opts.immersion });
    if (conversation[0] && conversation[0].role === 'system') conversation[0].content = sys;
    else conversation.unshift({ role: 'system', content: sys });
    updateContextMeter();
  }

  function setOptions(patch) {
    if (patch) Object.assign(opts, patch);
    if (topModel && opts.model) {
      if (!Array.from(topModel.options).some((o) => o.value === opts.model)) {
        const o = document.createElement('option'); o.value = opts.model; o.textContent = opts.model;
        topModel.appendChild(o);   // custom model ids (OpenRouter etc.) stay selectable in the top bar
      }
      topModel.value = opts.model;   // keep the top-bar switcher in sync
    }
    updateRouteChip();
  }

  // ---- The route chip: how THIS chat's sends travel (connection +, on OpenRouter, provider) ----
  let routeInfo = null;          // last connections:route answer for the current model
  let routePopover = null;
  function effectiveRoute() {
    if (!routeInfo) return '';
    if (routeInfo.isOpenRouter) {
      if (opts.provider === 'auto') return 'auto';
      return opts.provider || routeInfo.modelPin || 'auto';
    }
    return routeInfo.connectionName;
  }
  async function updateRouteChip() {
    const chip = document.getElementById('routeChip');
    if (!chip) return;
    const model = opts.model;
    try { routeInfo = await window.api.modelRoute(model); } catch (e) { return; }
    if (model !== opts.model) return;   // model changed while asking — a later call owns the chip
    if (!routeInfo || !routeInfo.connectionName) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = routeInfo.isOpenRouter ? ('via OR · ' + effectiveRoute()) : ('via ' + routeInfo.connectionName);
    chip.title = routeInfo.isOpenRouter
      ? 'Route: ' + (effectiveRoute() === 'auto' ? 'auto (OpenRouter load-balances)' : effectiveRoute() + ' (no fallbacks)') + ' — click to change'
      : 'Routed by your "' + routeInfo.connectionName + '" connection';
  }
  function closeRoutePopover() { if (routePopover) { routePopover.remove(); routePopover = null; } }
  async function toggleRoutePopover() {
    if (routePopover) { closeRoutePopover(); return; }
    const chip = document.getElementById('routeChip');
    if (!chip || !routeInfo) return;
    const pop = document.createElement('div');
    pop.className = 'route-pop';
    const head = document.createElement('div');
    head.className = 'route-pop-head';
    head.textContent = 'Route · ' + (opts.model || '');
    pop.appendChild(head);
    const mkRow = (label, sub, active, fn) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'route-row' + (active ? ' active' : '');
      const l = document.createElement('span'); l.textContent = label; row.appendChild(l);
      if (sub) { const s = document.createElement('em'); s.textContent = sub; row.appendChild(s); }
      row.addEventListener('click', fn);
      pop.appendChild(row);
      return row;
    };
    if (!routeInfo.isOpenRouter) {
      const note = document.createElement('div');
      note.className = 'route-note';
      note.textContent = 'This model travels through your "' + routeInfo.connectionName + '" connection. Provider routing is an OpenRouter feature.';
      pop.appendChild(note);
    } else {
      mkRow('Auto', 'let OpenRouter route · fallbacks on', effectiveRoute() === 'auto', () => { setOptions({ provider: 'auto' }); persist(); closeRoutePopover(); });
      const listHost = document.createElement('div');
      listHost.className = 'route-list';
      const loading = document.createElement('div');
      loading.className = 'route-note';
      loading.textContent = 'providers…';
      listHost.appendChild(loading);
      pop.appendChild(listHost);
      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'route-refresh';
      refreshBtn.textContent = '↻ refresh';
      refreshBtn.title = 'Re-fetch the provider list for this model (manual — nothing refreshes on its own)';
      refreshBtn.addEventListener('click', () => fillList(true));
      pop.appendChild(refreshBtn);
      async function fillList(refresh) {
        const r = await window.api.openrouterEndpoints(opts.model, refresh);
        listHost.innerHTML = '';
        if (!r.ok && !r.endpoints.length) {
          const n = document.createElement('div');
          n.className = 'route-note';
          n.textContent = 'Provider list unavailable (offline or not an OpenRouter model). "Auto" still works.';
          listHost.appendChild(n);
          return;
        }
        for (const e of r.endpoints) {
          mkRow(e.tag, e.quantization, effectiveRoute() === e.tag, () => { setOptions({ provider: e.tag }); persist(); closeRoutePopover(); });
        }
      }
      fillList(false);   // cached copy instantly; refresh control re-fetches on demand
    }
    document.body.appendChild(pop);
    const r = chip.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 320, Math.round(r.left))) + 'px';
    routePopover = pop;
    setTimeout(() => {
      const off = (e) => { if (!pop.contains(e.target) && e.target !== chip) { closeRoutePopover(); document.removeEventListener('mousedown', off); } };
      document.addEventListener('mousedown', off);
    }, 0);
  }
  function setActiveLore(arr) { activeLore = Array.isArray(arr) ? arr.filter((lb) => lb && Array.isArray(lb.entries)) : []; updateContextMeter(); }

  // Phrase bans (engine in Constellation.engines.bans — shared with the CLI). The model never sees
  // this list; ticks are tidied out of replies after generation. Rules: `find = replace` (or `find =`).
  function setPhraseBans(text) { phraseBanRules = Constellation.engines.bans.parse(text); }
  function applyPhraseBans(text) { return Constellation.engines.bans.apply(text, phraseBanRules); }

  async function init() {
    try {
      const modes = await window.api.loadModes();
      roleplayPrompt = (modes.roleplay || '').trim();
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
    try { projectInstructions = ((await window.api.loadProject()) || '').trim(); } catch (e) { console.warn('[constellation]', e && e.message || e); }

    conversation = [{ role: 'system', content: compose.buildSystem({ roleplayPrompt: roleplayPrompt, systemFiles: systemFiles, projectFiles: projectFiles, immersion: opts.immersion }) }];

    let cfg = { hasKey: false, model: 'glm-5.2' };
    try { cfg = await window.api.loadConfig(); } catch (e) { console.warn('[constellation]', e && e.message || e); }
    opts.model = cfg.model || 'glm-5.2';
    updateRouteChip();   // chip reflects the boot-time model's route
    opts.temperature = cfg.temperature ?? opts.temperature;
    opts.topP = cfg.topP ?? opts.topP;
    opts.maxTokens = cfg.maxTokens ?? opts.maxTokens;
    opts.thinking = !!cfg.thinking;
    opts.reasoningEffort = cfg.reasoningEffort || 'max';
    opts.teachEdits = cfg.teachEdits === true;   // off unless explicitly on — edits stay private by default
    opts.preservedThinking = cfg.preservedThinking !== false;   // GLM Preserved Thinking — on by default
    opts.immersion = cfg.immersion === true;   // immersion grammar — off until asked for
    opts.sendAttachments = cfg.sendAttachments !== false;   // off = only the newest user message's files are sent
    opts.streamCps = cfg.streamCps ?? 0;
    opts.contextWindow = cfg.contextWindow ?? 0;
    opts.dialogueStyle = cfg.dialogueStyle || 'off';
    opts.cadenceMarks = cfg.cadenceMarks === true;
    opts.streamInk = cfg.streamInk === true;
    opts.projectDepth = Math.max(0, Math.min(12, parseInt(cfg.projectDepth, 10) || 0));   // global: which floor the project fence rides
    opts.loreTag = /^[A-Za-z0-9_-]{1,40}$/.test(String(cfg.loreTag || '').trim()) ? String(cfg.loreTag).trim() : 'lore';   // global lore fence word
    opts.projectFenceTag = 'project_instructions';   // per-chat; setPrompts/loadSession refine it
    setPhraseBans(cfg.phraseBans || '');
    loadDisplayFilters();   // display-only regex rules (config/display-filters.txt); fire-and-forget
    applyDialogue();        // dialogue voice + cadence: config to md.js, class on <body>
    if (cfg.hasKey) setStatus('connected', 'ok');   // model lives in the top-bar dropdown next to this pill
    else setStatus('add your API key in Settings', 'err');

    // The sculpt module (message editing/variants) owns no state — it reaches ours through
    // these hooks. Getters survive conversation reassignment on chat switches.
    sculpt.init({
      conv: () => conversation,
      busy: () => busy,
      persist: persist,
      meter: updateContextMeter,
      renderBodyHTML: renderBodyHTML,
      enhanceCodeBlocks: enhanceCodeBlocks,
      updateMeta: updateMeta,
      applyBookmarkGlyph: applyBookmarkGlyph,
      addLoreIndicator: addLoreIndicator,
      addMessage: addMessage,
      streamReply: (vt) => stream.streamReply(vt),
      fileChipEl: fileChipEl,
      toggleBookmark: toggleBookmark,
      continueReply: continueReply,
      filterBtn: filterBtn,
      toggleRawView: toggleRawView,
      macrosOn: () => !!opts.castMacros,
      forkBundle: () => ({ system: roleplayPrompt, project: projectInstructions, gen: genSnapshot(), character: currentCharacter, projectFenceTag: projectFenceTag, cardBlock: cardBlock, personaBlock: personaBlock, cardReinject: cardReinject, cardReinjectAt: cardReinjectAt }),
      streamReply: (vt) => stream.streamReply(vt),
    });
    // The stream module owns the send→wire→reveal pipeline; everything it touches from
    // the chat closure arrives through these hooks (same pattern as sculpt).
    stream.init({
      busy: () => busy,
      setBusy: (v) => { busy = v; },
      getOpts: () => opts,
      sendBtn: () => sendBtn,
      statusText: () => statusEl.textContent,
      messagesEl: () => messagesEl,
      setStatus: setStatus,
      maybeScroll: maybeScroll,
      updateJumpBtn: updateJumpBtn,
      atBottom: atBottom,
      captureScrollAnchor: captureScrollAnchor,
      restoreScrollAnchor: restoreScrollAnchor,
      buildLoreContext: buildLoreContext,
      addLoreIndicator: addLoreIndicator,
      addMessage: addMessage,
      renderBodyHTML: renderBodyHTML,
      applyPhraseBans: applyPhraseBans,
      enhanceCodeBlocks: enhanceCodeBlocks,
      hasFilterEffect: hasFilterEffect,
      filterBtn: filterBtn,
      updateMeta: updateMeta,
      takePrefill: () => { const s = activePrefill; activePrefill = ''; return s; },
      setLastRequest: (lr) => { lastRequest = lr; },
      setCurrentRequest: (id) => { currentRequest = id; },
      cancelStream: cancelStream,
      restoreSendBtn: restoreSendBtn,
      addUsageTokens: (n) => { usage.tokens += n; },
      addUsageRequest: () => { usage.requests++; },
      getConv: () => conversation,
      projectInstructions: () => projectInstructions,
      persistTurn: persist,
      updateContextMeter: updateContextMeter,
      setContextExact: (n) => { contextExact = n; },
      focusInput: () => inputEl.focus(),
      friendlyError: friendlyError,
    });

    bind();
  }

  function bind() {
    sendBtn.addEventListener('click', () => { if (busy) cancelStream(); else send(); });
    if (ctxMeter) {
      ctxMeter.addEventListener('click', viewLastRequest);
      ctxMeter.style.cursor = 'pointer';
    }
    messagesEl.addEventListener('click', (e) => { const r = e.target.closest('.g-redact'); if (r) r.classList.toggle('on'); });   // gated text: click to reveal/hide
    const cr = document.getElementById('closeRequest');
    if (cr) cr.addEventListener('click', closeRequestView);
    const ro = document.getElementById('requestOverlay');
    if (ro) {
      ro.addEventListener('click', (e) => { if (e.target === ro) closeRequestView(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRequestView(); });
    }
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    inputEl.addEventListener('input', autoGrow);
    // Persist the in-progress input as this chat's draft (debounced).
    let draftTimer = null;
    inputEl.addEventListener('input', () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        if (window.Constellation && window.Constellation.sessions && window.Constellation.sessions.saveDraft) {
          window.Constellation.sessions.saveDraft(inputEl.value);
        }
      }, 400);
    });
    if (topModel) topModel.addEventListener('change', () => {
      const model = topModel.value;
      setOptions({ model, provider: '' });   // new model -> route resets to its connection's default
      setStatus('connected', 'ok');
      persist();   // model is per-chat -> save it with this chat
    });
    const routeChip = document.getElementById('routeChip');
    if (routeChip) routeChip.addEventListener('click', toggleRoutePopover);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRoutePopover(); });
    autoGrow();
    watchComposerGrowth();   // composer resizing follows the reader without flicker
    // "Lead its thinking" drawer — a one-shot reasoning seed for the next send.
    const pfBtn = document.getElementById('prefillBtn');
    const pfRow = document.getElementById('prefillRow');
    const pfInput = document.getElementById('prefillInput');
    window.autoGrowPrefill = () => {
      if (!pfInput) return;
      pfInput.style.height = 'auto';
      pfInput.style.height = Math.min(120, pfInput.scrollHeight) + 'px';
    };
    if (pfBtn && pfRow) pfBtn.addEventListener('click', () => {
      pfRow.hidden = !pfRow.hidden;
      if (!pfRow.hidden && pfInput) { pfInput.focus(); autoGrowPrefill(); }
    });
    if (pfInput) {
      pfInput.addEventListener('input', window.autoGrowPrefill);
      pfInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pfRow.hidden = true; inputEl.focus(); } });
    }
    messagesEl.addEventListener('click', (e) => sculpt.onMessageClick(e));
    messagesEl.addEventListener('scroll', () => { updateJumpBtn(); updateReadProgress(); if (window.Constellation && window.Constellation.colorfx) window.Constellation.colorfx.scan(messagesEl); }, { passive: true });
    window.addEventListener('resize', updateReadProgress);
    if (jumpBtn) jumpBtn.addEventListener('click', () => { scrollToBottom(); updateJumpBtn(); });

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportChat);

    // File attachments: paperclip button + drag-and-drop a file onto the chat.
    const fileInput = document.getElementById('fileInput');
    const attachBtn = document.getElementById('attachBtn');
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });
    }
    const allowDrop = (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault();
    };
    const drop = (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }
    };
    [inputEl, messagesEl].forEach((el) => {
      el.addEventListener('dragover', allowDrop);
      el.addEventListener('drop', drop);
    });
  }

  function autoGrow() {
    // Giant pastes: the height is already at its cap, and forcing a reflow on a huge textarea is
    // what made the composer lag after repeated long pastes — skip the re-measure for big values.
    if (inputEl.value.length > 4000) { inputEl.style.height = '160px'; return; }
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(160, inputEl.scrollHeight) + 'px';
  }
  // A growing composer shrinks the reading pane from below. Follow it with a ResizeObserver:
  // its callback runs AFTER layout but BEFORE paint, so the height change and the scroll
  // correction reach the screen in the same frame — no flicker, no deferred double-paint.
  // (Scrolling from inside autoGrow itself raced the layout: the assignment clamped against
  // the stale scroll range and landed short; a setTimeout correction then painted twice.)
  let composerPinned = true;   // was the reader at the bottom at their last scroll position?
  function watchComposerGrowth() {
    if (!inputEl) return;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => { if (composerPinned) scrollToBottom(); }).observe(inputEl);
    }
    messagesEl.addEventListener('scroll', () => { composerPinned = atBottom(); }, { passive: true });
    // Chromium quirk: typing into the composer while the chat is scrolled to EXACT max makes the
    // browser nudge the scroll container up ~one line, every keystroke. Correct it inside a rAF —
    // rAF runs before the next paint, so the nudge and the correction share one frame (a setTimeout
    // landed between paints and flickered). Occluded windows stall rAF, but nothing is visible then.
    inputEl.addEventListener('input', () => {
      if (composerPinned) requestAnimationFrame(() => { if (composerPinned) scrollToBottom(); });
    });
  }

  // ---- File attachments: text (.md/.txt) read as context, images read as base64 for vision ----
  function fileSizeLabel(f) {
    if (f.kind === 'image') {
      const kb = (f.size || 0) / 1024;
      return kb >= 1024 ? (kb / 1024).toFixed(1) + 'MB' : Math.round(kb) + 'KB';
    }
    const n = (f.text || '').length;
    return n >= 1000 ? (Math.round(n / 100) / 10) + 'k chars' : n + ' chars';
  }

  // Builds a chip element. removable=true -> shows an × (pending in the composer). Images show a thumbnail.
  function fileChipEl(f, removable) {
    const chip = document.createElement('div');
    const isImg = f.kind === 'image' && f.dataUrl;
    const big = !isImg && f.text != null && f.text.length > 50000;
    chip.className = 'attach-chip' + (big ? ' large' : '') + (isImg ? ' image' : '') + (f.excluded ? ' excluded' : '');
    if (f.excluded) chip.title = 'Hidden from context — not sent to the model (eye in ✎ Edit)';
    if (isImg) {
      const thumb = document.createElement('img');
      thumb.className = 'attach-thumb'; thumb.src = f.dataUrl; thumb.alt = f.name || ''; thumb.title = f.name || '';
      chip.appendChild(thumb);
    } else {
      const ico = document.createElement('span'); ico.className = 'attach-ico'; ico.textContent = '📄';
      chip.appendChild(ico);
    }
    const nm = document.createElement('span'); nm.className = 'attach-name'; nm.textContent = f.name;
    const sz = document.createElement('span'); sz.className = 'attach-size'; sz.textContent = fileSizeLabel(f);
    chip.appendChild(nm); chip.appendChild(sz);
    if (!removable) {
      // Sent-message chips carry a hover eye: hide/unhide from context in place — no edit mode,
      // no resend, the forward conversation is untouched. (Edit mode's larger eye overlays this.)
      const eye = document.createElement('button');
      eye.type = 'button'; eye.className = 'attach-eye-inline';
      const setTitle = () => { eye.title = f.excluded ? 'Hidden from context — click to send with future calls' : 'Sent with every call — click to hide from context (the conversation stays)'; };
      setTitle();
      eye.appendChild(sculpt.eyeSvg(!!f.excluded));   // eyeSvg lives in sculpt.js since the split
      eye.addEventListener('click', (ev) => {
        ev.stopPropagation();
        f.excluded = !f.excluded;
        persist();
        chip.classList.toggle('excluded', !!f.excluded);
        eye.replaceChildren(sculpt.eyeSvg(!!f.excluded));
        setTitle();
        updateContextMeter();
      });
      chip.appendChild(eye);
    }
    if (removable) {
      const x = document.createElement('button');
      x.className = 'attach-x'; x.type = 'button'; x.title = 'Remove'; x.textContent = '×';
      x.addEventListener('click', () => {
        pendingFiles = pendingFiles.filter((p) => p !== f);
        renderChips();
      });
      chip.appendChild(x);
    }
    return chip;
  }

  function renderChips() {
    const tray = document.getElementById('attachments');
    if (!tray) return;
    tray.replaceChildren();
    for (const f of pendingFiles) tray.appendChild(fileChipEl(f, true));
    tray.hidden = pendingFiles.length === 0;
  }

  function handleFiles(fileList) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    let remaining = arr.length;
    const done = () => { if (--remaining === 0) renderChips(); };
    for (const file of arr) {
      if (file.type.startsWith('image/')) {
        if (file.size > 8 * 1024 * 1024) { done(); continue; }   // skip images over 8MB (would bloat storage)
        const reader = new FileReader();
        reader.onload = () => { pendingFiles.push({ name: file.name, size: file.size, kind: 'image', dataUrl: String(reader.result || '') }); done(); };
        reader.onerror = done;
        reader.readAsDataURL(file);   // base64 data URL — sent to a vision model as image_url
      } else {
        const reader = new FileReader();
        reader.onload = () => { pendingFiles.push({ name: file.name, size: file.size, kind: 'text', text: String(reader.result || '') }); done(); };
        reader.onerror = done;
        reader.readAsText(file);
      }
    }
  }

  // (composeUserContent + toApiMessages now live in Constellation.compose — pure request
  // assembly: attachments, preserved thinking, lore section, writer's hand, project
  // fence, send-time macros. Call: compose.toApiMessages(opts, projectInstructions,
  // loreCtx, list).)

  // Conversation with attached file contents inlined (what actually goes to GLM).
  // What actually goes to GLM. When thinking is on we ALSO return each prior assistant turn's
  // reasoning_content verbatim (GLM "Preserved Thinking") so the model keeps reasoning continuity
  // across turns instead of re-deriving everything from scratch each time. The reasoning we stored
  // is the exact, unedited concatenation of the model's own reasoning_content deltas.

  // ---- Display filters: display-only regex rules from config/display-filters.txt.
  // Format: one rule per line — /pattern/flags => replacement  (bare pattern = delete).
  // '#' lines are comments; a commented-OUT rule ('# /…') is a disabled rule — the Settings
  // panel toggles rules by rewriting that marker, so no Notepad, no restart. DISPLAY-ONLY:
  // applied to rendered message bodies; the stored text, the model's context, and exports
  // keep the raw source.
  let displayFilters = null;   // null = not yet loaded; [] = loaded, no rules
  function parseDisplayFilters(text) {
    const rules = [];
    for (const line of String(text || '').split('\n')) {
      const l = line.trim();
      if (!l) continue;
      const disabled = l.startsWith('#');
      const body = disabled ? l.replace(/^#\s?/, '') : l;
      if (!body.startsWith('/')) {
        if (!disabled) console.warn('[constellation] display filter: unparsed line: ' + l.slice(0, 80));
        continue;   // plain comments and stray lines are not rules
      }
      const m = body.match(/^\/(.+)\/([gimsu]*)(?:\s*=>\s*([\s\S]*))?$/);
      const base = { src: line, enabled: !disabled, label: body };
      if (!m) { rules.push(Object.assign(base, { valid: false })); continue; }
      try { rules.push(Object.assign(base, { valid: true, re: new RegExp(m[1], m[2]), repl: m[3] != null ? m[3] : '' })); }
      catch (e) { console.warn('[constellation] display filter: bad regex: ' + l.slice(0, 80)); rules.push(Object.assign(base, { valid: false })); }
    }
    return rules;
  }
  async function loadDisplayFilters() {
    try { displayFilters = parseDisplayFilters(await window.api.loadDisplayFilters()); }
    catch (e) { displayFilters = []; console.warn('[constellation]', e && e.message || e); }
  }
  function applyDisplayFilters(text) {
    if (!displayFilters || !displayFilters.length) return text;
    let out = text;
    for (const r of displayFilters) if (r.enabled && r.valid) out = out.replace(r.re, r.repl);
    return out;
  }
  // ---- Settings panel bridge: list rules, toggle one (persisted into the file itself),
  // reload + re-render live. Toggling rewrites the '# ' marker on that line — the file
  // stays the single source of truth and remains hand-editable in both directions.
  function displayFiltersRules() {
    return displayFilters ? displayFilters.map((r) => ({ src: r.src, enabled: r.enabled, valid: r.valid })) : [];
  }
  async function toggleDisplayFilter(index) {
    try {
      const text = await window.api.loadDisplayFilters();
      let ruleIdx = -1;
      const lines = String(text || '').split('\n').map((line) => {
        const l = line.trim();
        if (!l) return line;
        const disabled = l.startsWith('#');
        const body = disabled ? l.replace(/^#\s?/, '') : l;
        if (!body.startsWith('/')) return line;   // comments/strays don't count
        ruleIdx++;
        if (ruleIdx !== index) return line;
        return disabled ? line.replace(/^(\s*)#\s?/, '$1') : line.replace(/^(\s*)/, '$1# ');
      });
      await window.api.saveDisplayFilters(lines.join('\n'));
      await loadDisplayFilters();
      rerenderAllBodies();
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
  }
  async function reloadDisplayFilters() {
    await loadDisplayFilters();
    rerenderAllBodies();
  }
  // One-click reveal: messages a rule actually touches get a 👁 Raw toggle in their action
  // bar — no Settings visit to see what's really written, one click to flip back.
  function hasFilterEffect(text) {
    return !!(displayFilters && displayFilters.length) && applyDisplayFilters(text) !== text;
  }
  function filterBtn(el) {
    if (!hasFilterEffect(String(el.__raw || ''))) return null;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'msg-action'; b.dataset.action = 'rawview';
    b.textContent = el.__rawView ? '👁 Filtered' : '👁 Raw';
    b.title = 'Toggle the display filters for this message — the stored text never changes';
    return b;
  }
  function toggleRawView(el) {
    el.__rawView = !el.__rawView;
    const body = el.querySelector('.body');
    if (body && el.__raw != null) {
      body.innerHTML = el.__rawView ? Constellation.md.render(el.__raw) : renderBodyHTML(el.__raw);
      enhanceCodeBlocks(body);
      if (window.Constellation && window.Constellation.colorfx) window.Constellation.colorfx.tagColors(body);
    }
    const btn = el.querySelector('[data-action="rawview"]');
    if (btn) btn.textContent = el.__rawView ? '👁 Filtered' : '👁 Raw';
  }
  function renderBodyHTML(content, opts) { return Constellation.md.render(applyDisplayFilters(content), opts); }

  // ---- dialogue voice + cadence + stream ink (Appearance settings, all off by default) ----
  const DLG_CLASSES = ['dlg-chiaroscuro', 'dlg-glass', 'dlg-editorial', 'dlg-acoustic', 'dlg-dramatis'];
  function applyDialogue(patch) {
    if (patch) {
      if (patch.dialogueStyle !== undefined) opts.dialogueStyle = patch.dialogueStyle;
      if (patch.cadenceMarks !== undefined) opts.cadenceMarks = !!patch.cadenceMarks;
      if (patch.streamInk !== undefined) opts.streamInk = !!patch.streamInk;
    }
    const md = window.Constellation && window.Constellation.md;
    if (md && md.setDialogue) md.setDialogue({ style: opts.dialogueStyle || 'off', cadence: !!opts.cadenceMarks });
    document.body.classList.remove.apply(document.body.classList, DLG_CLASSES.concat(['cadence-on']));
    const st = opts.dialogueStyle || 'off';
    if (DLG_CLASSES.indexOf('dlg-' + st) !== -1) document.body.classList.add('dlg-' + st);
    if (opts.cadenceMarks) document.body.classList.add('cadence-on');
    rerenderAllBodies();
  }
  function rerenderAllBodies() {
    for (const el of messagesEl.querySelectorAll('.msg')) {
      const body = el.querySelector('.body');
      if (!body || el.__raw == null) continue;
      body.innerHTML = renderBodyHTML(el.__raw);
      enhanceCodeBlocks(body);
      if (window.Constellation && window.Constellation.colorfx) window.Constellation.colorfx.tagColors(body);
    }
  }

  // Streaming ink (edge case #1): the reveal re-renders innerHTML every ~40ms, which
  // destroys and recreates the leading-edge nodes — a plain animation class would restart
  // at t=0 on every tick. Instead each trailing word gets an inline NEGATIVE delay equal to
  // its age behind the reveal cursor (age = charsBehind / cps × 1000ms), so every rebuilt
  // node re-enters the keyframe at the exact millisecond the previous tick left off —
  // continuous materialization with zero external state.

  // (MACRO_HINT, applySendMacros, trimForApi, estTokens now live in Constellation.compose —
  // applySendMacros(text, turns) takes the turn count explicitly; trimForApi takes the
  // context window. The send path freezes message-body macros BEFORE storing them.)

  // (Lorebook retrieval engine — tokenizing, chunking, BM25, fusion — now lives in
  //  Constellation.engines.lore, shared with the CLI so both run identical code. loreQuery stays
  //  here because it reads this chat's conversation.)
  function loreRecent(n) {
    return conversation.filter((m) => m.role !== 'system').slice(-(n || 16)).map((m) => ({ role: m.role, content: m.content || '' }));
  }
  // Linger/cooldown state lives per chat (which entry fired when) — localStorage, keyed by
  // session id. Ephemeral guidance, not story data.
  function loreStateKey() {
    const cid = (window.Constellation && window.Constellation.sessions && window.Constellation.sessions.chatId) ? window.Constellation.sessions.chatId() : null;
    return 'constellation_loreState_' + (cid || 'default');
  }
  function loreState() {
    try { return JSON.parse(localStorage.getItem(loreStateKey()) || '{}') || {}; } catch (e) { return {}; }
  }
  function loreStateSave(state) {
    try { localStorage.setItem(loreStateKey(), JSON.stringify(state || {})); } catch (e) {}
  }
  // Build the world-context payload for this turn by delegating to the shared engine (so the CLI
  // and the app run identical retrieval). loreEmbedFn hands the semantic embedder to the engine.
  function loreEmbedFn() {
    return (window.api && window.api.embedTexts)
      ? (async (t) => { try { const r = await window.api.embedTexts([t], true); return Array.isArray(r) && r[0] ? r[0] : null; } catch (e) { return null; } })
      : null;
  }
  async function buildLoreContext() {
    const recent = loreRecent(16);
    const report = await Constellation.engines.lore.buildLoreContext(activeLore, recent, loreEmbedFn(), { state: loreState(), scanDepth: 4 });
    loreStateSave(report.state);
    return report;
  }
  // The test bench: evaluate a hypothetical prompt (or the live chat's recent window) and
  // return the full per-entry report — fired / suppressed / cut, with scores and reasons.
  async function loreBench(customText) {
    const recent = customText && String(customText).trim()
      ? [{ role: 'user', content: String(customText) }].concat(loreRecent(15))
      : loreRecent(16);
    const report = await Constellation.engines.lore.buildLoreContext(activeLore, recent, loreEmbedFn(), { state: loreState(), scanDepth: 4 });
    loreStateSave(report.state);
    return report;
  }
  // Collect a streamed GLM reply into a string (no typewriter/DOM) — used by the dry-run test.
  function completeGlm(reqMsgs, optOverride) {
    return new Promise((resolve, reject) => {
      let full = '', reasoning = '';
      window.api.chatStream(reqMsgs, optOverride ? Object.assign({}, opts, optOverride) : opts, {
        onThink: (d) => { reasoning += d; },
        onChunk: (d) => { full += d; },
        onDone: (f, fin, usage) => { resolve({ full: f || full, reasoning, usage: usage || undefined }); },
        onError: (m) => { reject(new Error(m)); },
      });
    });
  }
  // Run the full send→GLM→phrase-ban pipeline for a HYPOTHETICAL message WITHOUT touching the real
  // conversation or saving — a non-destructive test of what GLM would reply (uses one API call).
  // dryRun: a hypothetical send that persists nothing. `system` REPLACES the system prompt and
  // `history` REPLACES the conversation for this one call — the prompt-lab primitives: iterate
  // candidate instructions AND multi-turn scenarios without touching the session on disk.
  async function dryRun(msg, system, history, callOpts) {
    let base = conversation;
    if (Array.isArray(history) && history.length) {
      base = history.map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : (m && m.role === 'system' ? 'system' : 'user'), content: String((m && m.content) || ''), reasoning: m && m.reasoning ? String(m.reasoning) : undefined }));
    }
    const conv = base.concat([{ role: 'user', content: String(msg || '') }]);
    const recentMsgs = conv.filter((m) => m.role !== 'system').slice(-16).map((m) => ({ role: m.role, content: m.content || '' }));
    const lc = await Constellation.engines.lore.buildLoreContext(activeLore, recentMsgs, loreEmbedFn(), { state: loreState(), scanDepth: 4 });
    let reqMsgs = compose.trimForApi(opts.contextWindow, compose.toApiMessages(opts, projectInstructions, lc, conv));
    const trimmedMessages = Math.max(0, conv.length - reqMsgs.filter((m) => m.role !== 'system').length);   // silent trimming misattributed to prompts is a lab's worst false positive
    if (system != null && String(system).length) {
      const stripped = reqMsgs.filter((m) => m.role !== 'system');
      // an override is a full replacement; the lab owns exactly what it sends
      reqMsgs = [{ role: 'system', content: String(system) }].concat(stripped);
    }
    const estReqTokens = Math.ceil(reqMsgs.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length) + (m.reasoning_content ? m.reasoning_content.length : 0), 0) / 4);
    const { full, reasoning, usage } = await completeGlm(reqMsgs, callOpts && callOpts.effort ? { reasoningEffort: String(callOpts.effort) } : undefined);
    const cleaned = applyPhraseBans(full);
    return { reply: cleaned, reasoning: reasoning || undefined, usage: usage || undefined, estReqTokens: estReqTokens, trimmedMessages: trimmedMessages, bansApplied: cleaned !== full, lore: lc.items.map((it) => ({ label: it.label, text: it.text })), systemOverridden: !!(system != null && String(system).length), historyOverridden: !!(Array.isArray(history) && history.length) };
  }
  // ---- CLI bridge handlers (Shape A) — non-destructive inspection/tests ----
  function getState() {
    return { model: opts.model, thinking: !!opts.thinking, reasoningEffort: opts.reasoningEffort || 'max', temperature: opts.temperature, topP: opts.topP, maxTokens: opts.maxTokens, contextWindow: opts.contextWindow, sendAttachments: opts.sendAttachments !== false, messageCount: Math.max(0, conversation.length - 1), activeLore: activeLore.length, banRules: phraseBanRules.length, castMacros: !!opts.castMacros };
  }
  async function testRetrieve(q) {
    const lc = await Constellation.engines.lore.buildLoreContext(activeLore, String(q || ''), loreEmbedFn());
    return { query: q, count: lc.items.length, items: lc.items.map((it) => ({ label: it.label, text: it.text })) };
  }
  function testBans(text) {
    const t = String(text || '');
    return { in: t, out: applyPhraseBans(t), rules: phraseBanRules.length };
  }

  // Markdown rendering lives in Constellation.md (src/js/md.js).

  // Give each finished code block an expand/collapse toggle so wide blocks can wrap to the
  // window instead of scrolling left↔right. Run once after a message is fully rendered.
  function enhanceCodeBlocks(bodyEl) {
    if (!bodyEl) return;
    const pres = bodyEl.querySelectorAll('pre');
    for (const pre of pres) {
      if (pre.closest('.codeblock') || pre.dataset.enhanced === '1') continue;
      pre.dataset.enhanced = '1';
      const wrap = document.createElement('div');
      wrap.className = 'codeblock';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const bar = document.createElement('div');
      bar.className = 'codeblock-bar';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'codeblock-toggle';
      copy.textContent = '⎘ Copy';
      copy.addEventListener('click', () => {
        if (window.api && window.api.writeClipboard) window.api.writeClipboard(pre.textContent || '');
        copy.textContent = '✓ Copied';
        setTimeout(() => { copy.textContent = '⎘ Copy'; }, 1200);
      });
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'codeblock-toggle';
      toggle.textContent = '⤢ Expand';
      toggle.title = 'Wrap long lines so you can read without scrolling sideways';
      toggle.addEventListener('click', () => {
        const expanded = pre.classList.toggle('expanded');
        toggle.textContent = expanded ? '⤡ Collapse' : '⤢ Expand';
      });
      bar.appendChild(copy);
      bar.appendChild(toggle);
      wrap.insertBefore(bar, pre);
    }
  }

  function clearEmptyHint() {
    const hint = messagesEl.querySelector('.empty-hint');
    if (hint) hint.remove();
  }


  // Lorebook transparency log: a collapsible "🌍 N world entries used" note on a reply showing
  // exactly which lorebook entries fired for that turn. Snapshotted onto the message so it survives
  // reload — display-only metadata (never sent to the API, never re-scanned, so it can't compound).
  function addLoreIndicator(el, items) {
    if (!items || !items.length) return;
    const old = el.querySelector('.lore-used');
    if (old) old.remove();
    const ind = document.createElement('div');
    ind.className = 'lore-used';
    const head = document.createElement('button');
    head.type = 'button'; head.className = 'lore-used-head';
    head.textContent = '🌍 ' + items.length + (items.length === 1 ? ' passage' : ' passages') + ' pulled';
    const list = document.createElement('div');
    list.className = 'lore-used-list'; list.hidden = true;
    for (const it of items) {
      const item = document.createElement('div'); item.className = 'lore-used-item';
      const lab = document.createElement('div'); lab.className = 'lore-used-label';
      lab.textContent = it.label || 'world context';
      const bodyEl = document.createElement('div'); bodyEl.className = 'lore-used-body';
      bodyEl.textContent = String(it.text || '').replace(/\s+/g, ' ').trim();
      item.appendChild(lab); item.appendChild(bodyEl);
      list.appendChild(item);
    }
    head.addEventListener('click', () => { const open = list.hidden; list.hidden = !open; head.classList.toggle('open', open); });
    ind.appendChild(head); ind.appendChild(list);
    const acts = el.querySelector('.msg-actions');
    if (acts) el.insertBefore(ind, acts); else el.appendChild(ind);
  }

  function addMessage(role, content, files, reasoning, lore, flags) {
    clearEmptyHint();
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    if (files && files.length) el.__files = files;
    el.__raw = content || '';   // keep the raw source so Edit works on markdown, not rendered text

    const label = document.createElement('div');
    label.className = 'role';
    const glyph = document.createElement('span');
    glyph.className = 'role-glyph';
    glyph.textContent = role === 'user' ? '✧' : '✦';
    label.appendChild(glyph);
    label.appendChild(document.createTextNode(' ' + (role === 'user' ? 'You' : 'GLM')));
    el.appendChild(label);

    // Collapsible "thinking" block (assistant only). Hidden unless the model emits reasoning,
    // or a saved reasoning block is being restored from disk. The ✎ in the header opens the
    // reasoning editor — editing what the model will "remember having thought" next send.
    let thinkDetails = null, thinkBody = null;
    if (role === 'assistant') {
      thinkDetails = document.createElement('details');
      thinkDetails.className = 'think-block';
      thinkDetails.hidden = true;
      const sum = document.createElement('summary');
      const sumLbl = document.createElement('span');
      sumLbl.className = 'think-lbl';
      sumLbl.textContent = '✦ Thinking';
      sum.appendChild(sumLbl);
      const editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.className = 'think-edit-btn'; editBtn.textContent = '✎';
      editBtn.title = 'Edit this reasoning — the model treats it as its own prior thinking (steers the next reply)';
      editBtn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); sculpt.startThinkEdit(el, thinkDetails); });
      sum.appendChild(editBtn);
      thinkDetails.appendChild(sum);
      thinkBody = document.createElement('div');
      thinkBody.className = 'think-body';
      thinkDetails.appendChild(thinkBody);
      el.appendChild(thinkDetails);
      if (reasoning) {            // restore a saved thinking block (closed by default)
        thinkDetails.hidden = false;
        thinkBody.textContent = reasoning;
        sculpt.syncThinkEditedMark(el, reasoning);
      }
    }

    const body = document.createElement('div');
    body.className = 'body md';
    body.innerHTML = renderBodyHTML(content);
    enhanceCodeBlocks(body);     // attach expand/collapse toggles to finished code blocks
    if (window.Constellation && window.Constellation.colorfx) window.Constellation.colorfx.tagColors(body);   // tag color words for the scan flare
    el.appendChild(body);

    // Attachment chips shown inside the message bubble (display only).
    if (files && files.length) {
      const fc = document.createElement('div');
      fc.className = 'msg-files';
      for (const f of files) fc.appendChild(fileChipEl(f, false));
      el.appendChild(fc);
    }

    // Word/char count under responses (assistant only) — with a ✎ marker once sculpted.
    if (role === 'assistant') {
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      updateMeta(meta, body.textContent, !!(flags && flags.edited));
      el.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    if (role === 'user') actions.appendChild(sculpt.actionBtn('edit', '✎ Edit'));
    if (role !== 'user') {
      actions.appendChild(sculpt.actionBtn('regen', '↻ Retry'));
      actions.appendChild(sculpt.actionBtn('sculpt', '✎ Sculpt'));
    }
    actions.appendChild(sculpt.actionBtn('fork', '⑂ Fork'));
    actions.appendChild(sculpt.actionBtn('copy', '⎘ Copy'));
    const fb = filterBtn(el); if (fb) actions.appendChild(fb);
    actions.appendChild(sculpt.actionBtn('bookmark', '☆'));
    el.appendChild(actions);
    applyBookmarkGlyph(el);
    if (role === 'assistant' && lore && lore.length) addLoreIndicator(el, lore);

    messagesEl.appendChild(el);
    // Your own send pulls you to the newest exchange; model-side additions only follow if you
    // were already reading at the bottom — never yank someone who scrolled up mid-generation.
    if (!bulkScroll) { if (role === 'user') scrollToBottom(); else maybeScroll(); updateJumpBtn(); updateReadProgress(); }
    return { el, body, thinkDetails, thinkBody };
  }

  function friendlyError(msg) {
    const m = String(msg || '');
    if (/unsafe|sensitive content|potentially.*content/i.test(m)) {
      return "GLM's safety layer flagged this conversation. Old attachments riding along in context are a common trigger — hide them with the eye in ✎ Edit, or turn off Send attachments (newest only) in Settings → Generation, then retry.";
    }
    if (/429|余额|insufficient|quota|rate.?limit/i.test(m)) {
      return 'GLM says your account is out of credits or lacks a resource pack for this model/endpoint (429). Check model/endpoint in Settings.';
    }
    if (/401|unauthorized|invalid.{0,6}key/i.test(m)) {
      return 'GLM rejected the API key (401). Check the key in Settings.';
    }
    if (/unknown model|model.{0,20}(does not exist|not found)|modelCode/i.test(m)) {
      return 'That model is not available on this endpoint (or was retired). Vision models need the General endpoint — check Settings → Connection, then pick a current model.';
    }
    return m;
  }


  async function send() {
    const text = inputEl.value.trim();
    const files = pendingFiles.slice();
    if ((!text && !files.length) || busy) return;
    const pf = document.getElementById('prefillInput');
    activePrefill = (pf && pf.value.trim()) || '';
    if (pf) { pf.value = ''; autoGrowPrefill(); }
    const pfRow = document.getElementById('prefillRow');
    if (pfRow) pfRow.hidden = true;
    contextExact = null;   // new content — the exact count is stale until the next tokenizer pass
    pendingFiles = [];
    renderChips();
    // Message-body macros FREEZE at first send: the resolved value is written into the
    // stored message (the drawer's copy gets scratched), so history forever shows the
    // number the model actually saw. System + fence macros keep refreshing by design —
    // {{turn}} at turn 7 should say 7.
    const outText = opts.castMacros && compose.MACRO_HINT.test(text) ? compose.applySendMacros(text, conversation.filter((m) => m.role === 'user').length) : text;
    addMessage('user', outText, files);
    conversation.push({ role: 'user', content: outText, files: files.length ? files : undefined });
    inputEl.value = '';
    autoGrow();
    updateContextMeter();
    if (window.Constellation && window.Constellation.sessions && window.Constellation.sessions.saveDraft) window.Constellation.sessions.saveDraft('');   // sent -> clear the draft
    sendBtn.classList.add('pulse');
    setTimeout(() => sendBtn.classList.remove('pulse'), 500);
    stream.streamReply();
  }

  // Stop the in-flight stream (keeps whatever was already generated).
  function cancelStream() {
    if (currentRequest && window.api && window.api.cancelStream) {
      try { window.api.cancelStream(currentRequest); } catch (e) { console.warn('[constellation]', e && e.message || e); }
    }
  }
  function restoreSendBtn() {
    sendBtn.classList.remove('stop');
    sendBtn.textContent = '➤';
    sendBtn.title = 'Send (Enter)';
    currentRequest = null;
  }

  // ---- bookmarks (star a passage; jump back to it from the Bookmarks overlay) ----
  // Set the ☆/★ glyph + accent from a data-bookmarked flag on the message element.
  function applyBookmarkGlyph(el) {
    const btn = el.querySelector('.msg-action[data-action="bookmark"]');
    if (!btn) return;
    const on = el.dataset.bookmarked === '1';
    btn.textContent = on ? '★' : '☆';
    btn.classList.toggle('on', on);
    btn.title = on ? 'Bookmarked' : 'Bookmark this passage';
  }
  async function toggleBookmark(el) {
    const msgs = Array.from(messagesEl.querySelectorAll('.msg'));
    const msgIndex = msgs.indexOf(el);
    if (msgIndex === -1) return;
    const raw = el.__raw ? el.__raw : (el.querySelector('.body') ? el.querySelector('.body').textContent : '');
    const head = String(raw).replace(/\s+/g, ' ').trim().slice(0, 80);   // stored so a jump can re-find the message even if its index shifts
    const role = el.classList.contains('user') ? 'user' : 'assistant';
    if (!(window.Constellation && window.Constellation.sessions && window.Constellation.sessions.toggleBookmark)) return;
    const res = await window.Constellation.sessions.toggleBookmark({ msgIndex, head, role });
    el.dataset.bookmarked = res.bookmarked ? '1' : '';
    applyBookmarkGlyph(el);
    if (window.Constellation.toast) window.Constellation.toast(res.bookmarked ? 'Bookmarked' : 'Bookmark removed');
    if (window.Constellation.storySky && window.Constellation.storySky.refresh) window.Constellation.storySky.refresh();   // a star is born (or fades) immediately
  }
  // Mark which messages in the current chat are already bookmarked (called after a chat loads).
  function markBookmarks(indices) {
    const set = new Set(indices);
    messagesEl.querySelectorAll('.msg').forEach((el, i) => { el.dataset.bookmarked = set.has(i) ? '1' : ''; applyBookmarkGlyph(el); });
  }
  function refreshBookmarkGlyphs() {
    if (window.Constellation && window.Constellation.sessions && window.Constellation.sessions.bookmarksForCurrent) {
      window.Constellation.sessions.bookmarksForCurrent().then((list) => markBookmarks(list.map((b) => b.msgIndex)));
    if (window.Constellation.storySky && window.Constellation.storySky.refresh) window.Constellation.storySky.refresh();   // stars are born (or fade) with bookmarks
    }
  }
  // Jump to a specific message (by index, verified by its stored head text) and flash it — used by the overlay.
  function scrollToMessage(msgIndex, head) {
    const msgs = Array.from(messagesEl.querySelectorAll('.msg'));
    let el = (msgIndex != null && msgs[msgIndex]) ? msgs[msgIndex] : null;
    if (!el && head) {
      const h = String(head).toLowerCase().slice(0, 60);
      el = msgs.find((m) => {
        const raw = m.__raw ? m.__raw : (m.querySelector('.body') ? m.querySelector('.body').textContent : '');
        return h && String(raw).toLowerCase().includes(h);
      }) || null;
    }
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('match-flash');
      setTimeout(() => el.classList.remove('match-flash'), 1600);
    }
  }
  // Continue a reply that was cut off by the length cap: ask the model to pick up where it stopped.
  function continueReply(el) {
    if (busy) return;
    const text = 'Continue from where you left off.';
    addMessage('user', text);
    conversation.push({ role: 'user', content: text });
    updateContextMeter();
    stream.streamReply();
  }


  // ---- the "what was sent" inspector: click the ◐ meter to see the exact last request ----
  function viewLastRequest() {
    const ov = document.getElementById('requestOverlay');
    const summary = document.getElementById('requestSummary');
    const body = document.getElementById('requestBody');
    if (!ov || !body || !summary) return;
    summary.replaceChildren();
    body.replaceChildren();
    if (!lastRequest) {
      summary.textContent = 'Nothing sent in this chat yet.';
      const e = document.createElement('div');
      e.className = 'chronicle-empty';
      e.textContent = 'Send a message, then click the ◐ meter — the full request (system prompt, injected lore, every message) appears here for that send.';
      body.appendChild(e);
    } else {
      const o = lastRequest.opts;
      const est = Math.round(lastRequest.messages.reduce((n, m) => n + String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length, 0) / 4);
      summary.textContent = lastRequest.model + ' · ' + lastRequest.messages.length + ' messages · ~' + (est >= 1000 ? (est / 1000).toFixed(1) + 'k' : est) + ' tokens · temp ' + o.temperature + ' · top_p ' + o.top_p
        + ' · thinking ' + (o.thinking ? 'on (' + o.effort + ')' : 'off') + ' · max_tokens ' + o.max_tokens
        + (o.context_window ? ' · trimmed to ' + o.context_window + ' ctx' : '') + ' · sent ' + lastRequest.at;
      lastRequest.messages.forEach((m, i) => {
        const row = document.createElement('div');
        row.className = 'request-msg role-' + (m.role || 'user');
        const head = document.createElement('div');
        head.className = 'request-msg-head';
        const chip = document.createElement('span');
        chip.className = 'request-role';
        chip.textContent = (m.role || '?') + (i === 0 ? ' · instructions + lore' : '');
        const size = document.createElement('span');
        size.className = 'request-size';
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
        const think = m.reasoning_content ? String(m.reasoning_content) : '';
        size.textContent = text.length.toLocaleString() + ' chars' + (think ? ' + thinking ' + think.length.toLocaleString() : '');
        head.appendChild(chip); head.appendChild(size);
        // Preserved thinking, shown as its own collapsible block — proof it rides the request.
        if (think) {
          const td = document.createElement('details');
          td.className = 'request-think';
          const sum = document.createElement('summary');
          sum.textContent = '✦ thinking · ' + think.length.toLocaleString() + ' chars (preserved, sent back verbatim)';
          td.appendChild(sum);
          const tp = document.createElement('div');
          tp.className = 'request-think-text';
          tp.textContent = think;
          td.appendChild(tp);
          row.appendChild(head);
          row.appendChild(td);
        } else {
          row.appendChild(head);
        }
        const pre = document.createElement('div');
        pre.className = 'request-text';
        pre.textContent = text;
        row.appendChild(pre);
        body.appendChild(row);
      });
      const note = document.createElement('div');
      note.className = 'request-note';
      note.textContent = 'Exactly what left your machine for this one send. Phrase bans are applied AFTER generation, so they are not part of this.';
      body.appendChild(note);
    }
    ov.classList.add('open');
  }
  function closeRequestView() {
    const ov = document.getElementById('requestOverlay');
    if (ov) ov.classList.remove('open');
  }

  // Start a fresh empty chat (keeps the current system prompt + project instructions).
  function reset() {
    conversation = [{ role: 'system', content: compose.buildSystem({ roleplayPrompt: roleplayPrompt, systemFiles: systemFiles, projectFiles: projectFiles, immersion: opts.immersion }) }];
    usage = { tokens: 0, requests: 0 };
    currentCharacter = null;
    opts.castMacros = false;   // macros are a cast-chat feature; a fresh chat never substitutes
    pendingFiles = [];
    lastRequest = null;   // the inspector shows per-chat sends; switching chats clears it
    renderChips();
    messagesEl.replaceChildren();
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    const t = document.createElement('div'); t.className = 'empty-hint-title'; t.textContent = 'The sky is quiet.';
    const s = document.createElement('div'); s.className = 'empty-hint-sub'; s.textContent = 'Write something to begin.';
    hint.appendChild(t); hint.appendChild(s);
    messagesEl.appendChild(hint);
    setStatus('connected', 'ok');
    if (window.Constellation.mood) window.Constellation.mood.apply('neutral', true);   // a new chat starts under a neutral sky
    updateContextMeter();
    updateReadProgress();
  }

  // Load a saved chat. Its own system + project instructions are restored first, so the system
  // message reflects THIS chat (not whichever chat was loaded last).
  // Load a saved chat. The DOM swap runs inside a View Transition so the old thread dissolves into
  // the new one (a real crossfade, not a dip-to-black). Per-message auto-scroll is suppressed during
  // the bulk render so there's no vertical snap; we land once at the latest message.
  function loadSession(msgs, system, project, gen, incomingUsage, systemFiles, projectFiles, character, projectFence, cardBlk, personaBlk, cRe, cAt) {
    cardBlock = typeof cardBlk === 'string' ? cardBlk : null;
    personaBlock = typeof personaBlk === 'string' ? personaBlk : null;
    cardReinject = Math.max(0, Math.min(12, parseInt(cRe, 10) || 0));
    cardReinjectAt = Math.max(0, Math.min(1000000, parseInt(cAt, 10) || 0));
    if (system !== undefined || project !== undefined) setPrompts({ roleplay: system, project, systemFiles, projectFiles, projectFenceTag: projectFence, cardReinject, cardReinjectAt });
    if (gen) setOptions(gen);   // restore THIS chat's generation settings
    const swap = () => {
      reset();
      // Cast chats (and only cast chats) get send-time macros — a chat started from a card
      // opted into the engine; everything else must relay macro SYNTAX verbatim (changelogs,
      // prompt examples, documentation) without the dice rolling behind the reader's back.
      currentCharacter = character || null;
      opts.castMacros = !!character;
      usage = incomingUsage || { tokens: 0, requests: 0 };   // restore this chat's cumulative usage
      bulkScroll = true;
      const turns = (msgs || []).filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content, files: m.files, reasoning: m.reasoning, lore: m.lore, edited: m.edited, orig: m.orig, rOrig: m.rOrig, variants: m.variants, vActive: m.vActive }));
      conversation = [{ role: 'system', content: compose.buildSystem({ roleplayPrompt: roleplayPrompt, systemFiles: systemFiles, projectFiles: projectFiles, immersion: opts.immersion }) }].concat(turns);
      for (const m of turns) {
        // One bad message must never eat the rest of the chat: the view-transition wrapper
        // swallows exceptions from this loop, so a mid-list throw rendered truncated chats
        // with no visible error (v0.11.5's eyeSvg bug did exactly that). Render on; the
        // message stays in the conversation either way.
        try {
          const r = addMessage(m.role, m.content, m.files, m.reasoning, m.lore, { edited: m.edited });
          if (m.role === 'assistant' && Array.isArray(m.variants) && m.variants.length > 1 && r && r.el) sculpt.renderVariantNav(r.el);
        } catch (e) { console.warn('[constellation] message render failed (kept in context):', e && e.message || e); }
      }
      bulkScroll = false;
      scrollToBottom();           // land at the latest message in one move (no top→bottom snap)
      updateJumpBtn(); updateReadProgress();
      setStatus('connected', 'ok');
      updateContextMeter();
      refreshBookmarkGlyphs();    // restore ☆/★ on this chat's bookmarked messages
      if (window.Constellation.mood) window.Constellation.mood.assess(turns.slice(-3).map(function (m) { return m.content || ''; }).join(' '));   // sky remembers the tone you left on
    };
    if (document.startViewTransition) document.startViewTransition(swap);   // crossfade where supported
    else swap();                                                             // plain instant swap fallback
  }

  // The active chat's instructions — Settings reads these so the editors show what THIS chat uses.
  function getPrompts() { return { roleplay: roleplayPrompt, project: projectInstructions, systemFiles, projectFiles, projectFenceTag, cardReinject, cardReinjectAt }; }

  // The active chat's generation settings — Settings + Craft read these so they reflect THIS chat.
  function getOptions() { return Object.assign({}, opts); }

  // The per-chat gen bundle that gets persisted with the session. ONLY the model is per-chat —
  // freezing thinking/effort/etc here meant Settings changes silently never reached existing
  // chats (chats stuck on a stale effort was the "thinking got shorter" bug).
  function genSnapshot() {
    // Full generation settings persist per chat (this used to carry only the model — the
    // documented restore never actually survived a reload). provider = the chat's route.
    return { model: opts.model, provider: opts.provider || '', chronicleModel: opts.chronicleModel || '', chronicleProvider: opts.chronicleProvider || '', temperature: opts.temperature, topP: opts.topP, maxTokens: opts.maxTokens, thinking: !!opts.thinking, reasoningEffort: opts.reasoningEffort, streamCps: opts.streamCps, contextWindow: opts.contextWindow, preservedThinking: opts.preservedThinking, sendAttachments: opts.sendAttachments };
  }

  // Persist the current chat (messages + instructions + settings) now — used when you edit
  // instructions or generation in Settings without sending a new message.
  function persist() {
    if (conversation.length > 1 && window.Constellation && window.Constellation.sessions) {
      window.Constellation.sessions.saveCurrent(conversation.slice(1), roleplayPrompt, projectInstructions, genSnapshot(), usage, systemFiles, projectFiles);
    }
  }

  // The recent conversation as plain {role, content} pairs — the Chronicle distills these.
  function recentMessages(n) {
    return conversation.filter(function (m) { return m.role !== 'system'; }).slice(-(n || 200)).map(function (m) { return { role: m.role, content: m.content || '' }; });
  }

  // All of the user's typed messages in the current chat (used by Craft review).
  function getUserWriting() {
    return conversation.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  }

  // Restore / clear the composer draft (used when switching chats).
  function setDraft(text) {
    inputEl.value = text || '';
    autoGrow();
  }
  // Jump to the first message containing a search hit and flash it.
  function scrollToMatch(q) {
    const query = String(q || '').toLowerCase().trim();
    if (!query) return;
    for (const el of Array.from(messagesEl.querySelectorAll('.msg'))) {
      const body = el.querySelector('.body');
      if (body && body.textContent.toLowerCase().includes(query)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('match-flash');
        setTimeout(() => el.classList.remove('match-flash'), 1600);
        return;
      }
    }
  }

  return { init, setPrompts, getPrompts, getOptions, persist, setOptions, setActiveLore, setPhraseBans, setDraft, scrollToMatch, scrollToMessage, refreshBookmarkGlyphs, reset, loadSession, getUserWriting, recentMessages, getState, testRetrieve, testBans, dryRun, applyDialogue, loreBench, displayFiltersRules, toggleDisplayFilter, reloadDisplayFilters, testCompose: (list) => compose.toApiMessages(opts, projectInstructions, null, list || conversation) };   // bare call = the live conversation (probe convention)
})();
