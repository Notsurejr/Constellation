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

  let roleplayPrompt = '';
  let projectInstructions = '';
  let conversation = [];   // { role, content, files? } — conversation[0] is always the system message
  let busy = false;
  let currentRequest = null;   // active stream id, so the Stop button can cancel it
  let lastRequest = null;      // the exact payload of the most recent send (for the ◐ inspector)
  let bulkScroll = false;      // suppress per-message auto-scroll while bulk-rendering a chat
  let usage = { tokens: 0, requests: 0 };   // cumulative estimated tokens for the current chat
  let pendingFiles = [];   // [{ name, size, text }] queued attachments for the next send
  let opts = { model: 'glm-5.2', temperature: 0.8, topP: 0.95, maxTokens: 0, thinking: false, reasoningEffort: 'max', streamCps: 0, contextWindow: 0, teachEdits: false, preservedThinking: true };
  let activeLore = [];   // lorebooks enabled for the current chat (each { entries, semantic }); sessions applies this
  let phraseBanRules = [];   // [{ re, replace }] tidied out of GLM's replies AFTER generation (the model never sees these)
  let systemFiles = [];   // [{name,text}] .md/.txt attached to this chat's system instructions (inlined into the system prompt)
  let projectFiles = [];  // [{name,text}] attached to this chat's project instructions

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
    statusEl.classList.toggle('breathe', /^connected\b/.test(String(text)));   // gentle idle pulse
  }

  // Only auto-follow the stream when the reader is already near the bottom; if they've
  // scrolled up to read, leave their place alone and show a "jump to latest" button.
  function atBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  }
  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
  function maybeScroll() { if (atBottom()) scrollToBottom(); }
  function updateJumpBtn() { if (jumpBtn) jumpBtn.hidden = atBottom(); }

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
  function updateContextMeter() {
    if (!ctxMeter) return;
    let chars = 0;
    for (const m of conversation) {
      chars += (m.content || '').length;   // includes the system message (your instructions)
      if (m.files) for (const f of m.files) chars += (f.text || '').length;
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
    ctxMeter.textContent = trimming ? ('◐ ' + fmt(sent) + ' / ' + fmt(total)) : ('◐ ' + fmt(total));
    ctxMeter.title = (trimming ? ('Sending last ~' + fmt(sent) + ' of ' + fmt(total) + ' tokens (context window on)') : ('Estimated conversation size'))
                   + ' — click to see exactly what was sent';
  }

  // Export the current chat to a Markdown file via a native save dialog.
  async function exportChat() {
    const turns = conversation.filter((m) => m.role !== 'system');
    if (!turns.length) return;
    const firstUser = turns.find((m) => m.role === 'user');
    const title = (firstUser ? firstUser.content : 'chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'chat';
    const lines = ['# ' + title, ''];
    for (const m of turns) {
      lines.push('## ' + (m.role === 'user' ? 'You' : 'GLM'));
      lines.push('');
      lines.push(m.content || '');
      lines.push('');
    }
    try { await window.api.exportMarkdown(title, lines.join('\n')); if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Exported "' + title + '"'); } catch (e) {}
  }

  // Render attached .md/.txt files as delimited blocks (the model sees these as reference context).
  function filesBlock(files) {
    if (!files || !files.length) return '';
    return files.map((f) => '===== ' + f.name + ' (' + (f.text || '').length + ' chars) =====\n' + (f.text || '')).join('\n\n');
  }
  function buildSystem() {
    return [
      roleplayPrompt,
      projectInstructions && ('# Project instructions\n' + projectInstructions),
      filesBlock(systemFiles),
      filesBlock(projectFiles),
    ].filter(Boolean).join('\n\n');
  }

  function setPrompts({ roleplay, project, systemFiles: sFiles, projectFiles: pFiles }) {
    if (roleplay !== undefined) roleplayPrompt = (roleplay || '').trim();
    if (project !== undefined) projectInstructions = (project || '').trim();
    if (sFiles !== undefined) systemFiles = Array.isArray(sFiles) ? sFiles : [];
    if (pFiles !== undefined) projectFiles = Array.isArray(pFiles) ? pFiles : [];
    const sys = buildSystem();
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
    } catch (e) {}
    try { projectInstructions = ((await window.api.loadProject()) || '').trim(); } catch (e) {}

    conversation = [{ role: 'system', content: buildSystem() }];

    let cfg = { hasKey: false, model: 'glm-5.2' };
    try { cfg = await window.api.loadConfig(); } catch (e) {}
    opts.model = cfg.model || 'glm-5.2';
    opts.temperature = cfg.temperature ?? opts.temperature;
    opts.topP = cfg.topP ?? opts.topP;
    opts.maxTokens = cfg.maxTokens ?? opts.maxTokens;
    opts.thinking = !!cfg.thinking;
    opts.reasoningEffort = cfg.reasoningEffort || 'max';
    opts.teachEdits = cfg.teachEdits === true;   // off unless explicitly on — edits stay private by default
    opts.preservedThinking = cfg.preservedThinking !== false;   // GLM Preserved Thinking — on by default
    opts.streamCps = cfg.streamCps ?? 0;
    opts.contextWindow = cfg.contextWindow ?? 0;
    setPhraseBans(cfg.phraseBans || '');
    if (cfg.hasKey) setStatus('connected', 'ok');   // model lives in the top-bar dropdown next to this pill
    else setStatus('add your API key in Settings', 'err');

    bind();
  }

  function bind() {
    sendBtn.addEventListener('click', () => { if (busy) cancelStream(); else send(); });
    if (ctxMeter) {
      ctxMeter.addEventListener('click', viewLastRequest);
      ctxMeter.style.cursor = 'pointer';
    }
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
      setOptions({ model });
      setStatus('connected', 'ok');
      persist();   // model is per-chat -> save it with this chat
    });
    autoGrow();
    messagesEl.addEventListener('click', onMessageClick);
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
    chip.className = 'attach-chip' + (big ? ' large' : '') + (isImg ? ' image' : '');
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

  // Expand a user message's typed text + any attached file contents for the API.
  function composeUserContent(m) {
    let out = m.content || '';
    if (m.files && m.files.length) {
      const blocks = m.files.map((f) =>
        '===== Attached file: ' + f.name + ' (' + (f.text || '').length + ' chars) =====\n' + (f.text || '')
      ).join('\n\n');
      out += (out ? '\n\n' : '') + blocks;
    }
    return out;
  }

  // Conversation with attached file contents inlined (what actually goes to GLM).
  // What actually goes to GLM. When thinking is on we ALSO return each prior assistant turn's
  // reasoning_content verbatim (GLM "Preserved Thinking") so the model keeps reasoning continuity
  // across turns instead of re-deriving everything from scratch each time. The reasoning we stored
  // is the exact, unedited concatenation of the model's own reasoning_content deltas.
  function toApiMessages(loreCtx, src) {
    const list = src || conversation;
    const preserve = !!opts.thinking && opts.preservedThinking !== false;   // GLM Preserved Thinking (user-adjustable)
    const out = list.map((m) => {
      if (m.role === 'user' && m.files && m.files.length) {
        const imgs = m.files.filter((f) => f.kind === 'image' && f.dataUrl);
        if (imgs.length) {
          // Multimodal content array: the typed text (+ any text files) then each image, for a vision model.
          const textParts = [m.content || ''].concat(
            m.files.filter((f) => f.kind !== 'image').map((f) => '===== ' + f.name + ' =====\n' + (f.text || ''))
          );
          const textJoin = textParts.filter(Boolean).join('\n\n');
          const arr = [];
          if (textJoin) arr.push({ type: 'text', text: textJoin });
          for (const f of imgs) arr.push({ type: 'image_url', image_url: { url: f.dataUrl } });
          return { role: 'user', content: arr };
        }
        return { role: 'user', content: composeUserContent(m) };   // text files only → single string
      }
      const o = { role: m.role, content: m.content };
      if (preserve && m.role === 'assistant' && m.reasoning) o.reasoning_content = m.reasoning;
      return o;
    });
    // Lorebook: inject only the RELEVANT world context (constant entries + keyword matches + the
    // top BM25 passages from big reference docs) as a clearly-labeled section. `loreCtx` (if passed)
    // is reused so the request and the 🌍 log stay in sync.
    const lc = loreCtx != null ? loreCtx : buildLoreContext();
    if (lc.body && out[0] && out[0].role === 'system') {
      out[0] = { role: 'system', content: out[0].content + '\n\n# World\nBackground facts about this world (true; use as context):\n\n' + lc.body };
    }
    // The writer's hand (optional, off by default): your sculpted edits, shown to the model as the
    // voice it should lean toward. Disabled, edits stay entirely private to the story.
    if (opts.teachEdits && out[0] && out[0].role === 'system') {
      const pairs = list.filter((m) => m.role === 'assistant' && m.edited && m.orig && m.orig !== m.content);
      if (pairs.length) {
        const lines = pairs.slice(-10).map((m) => {
          const o = String(m.orig).replace(/\s+/g, ' ').trim().slice(0, 140);
          const n = String(m.content).replace(/\s+/g, ' ').trim().slice(0, 140);
          return '· "' + o + '" → "' + n + '"';
        });
        out[0] = { role: 'system', content: out[0].content + '\n\n# The writer\u2019s hand\nThe writer edits your replies after the fact; their edited wording is the voice they want. Lean toward it naturally — never mention or quote these notes.\n' + lines.join('\n') };
      }
    }
    return out;
  }

  // Sliding context window: if a token cap is set, drop the OLDEST middle turns from what's sent
  // (keeping the system message + the latest turn) until the estimate fits. The saved conversation
  // is never touched — this only trims the array handed to the API.
  function trimForApi(msgs) {
    const win = Number(opts.contextWindow) || 0;
    if (!win) return msgs;
    const sys = msgs[0] && msgs[0].role === 'system' ? msgs[0] : null;
    let body = sys ? msgs.slice(1) : msgs.slice();
    if (body.length <= 1) return msgs;
    const est = (arr) => Math.ceil(arr.reduce((n, m) => n + (m.content || '').length + (m.reasoning_content || '').length, 0) / 4);
    while (body.length > 1 && est(sys ? [sys].concat(body) : body) > win) body = body.slice(1);
    while (body.length > 1 && body[0].role === 'assistant') body = body.slice(1);   // keep it leading with a user turn
    return sys ? [sys].concat(body) : body;
  }

  // (Lorebook retrieval engine — tokenizing, chunking, BM25, fusion — now lives in
  //  Constellation.engines.lore, shared with the CLI so both run identical code. loreQuery stays
  //  here because it reads this chat's conversation.)
  function loreQuery() {
    return conversation.filter((m) => m.role !== 'system').slice(-4).map((m) => m.content || '').join('\n');
  }
  // Build the world-context payload for this turn by delegating to the shared engine (so the CLI
  // and the app run identical retrieval). loreEmbedFn hands the semantic embedder to the engine.
  function loreEmbedFn() {
    return (window.api && window.api.embedTexts)
      ? (async (t) => { try { const r = await window.api.embedTexts([t], true); return Array.isArray(r) && r[0] ? r[0] : null; } catch (e) { return null; } })
      : null;
  }
  async function buildLoreContext() {
    return Constellation.engines.lore.buildLoreContext(activeLore, loreQuery(), loreEmbedFn());
  }
  // Collect a streamed GLM reply into a string (no typewriter/DOM) — used by the dry-run test.
  function completeGlm(reqMsgs) {
    return new Promise((resolve, reject) => {
      let full = '', reasoning = '';
      window.api.chatStream(reqMsgs, opts, {
        onThink: (d) => { reasoning += d; },
        onChunk: (d) => { full += d; },
        onDone: (f) => { resolve({ full: f || full, reasoning }); },
        onError: (m) => { reject(new Error(m)); },
      });
    });
  }
  // Run the full send→GLM→phrase-ban pipeline for a HYPOTHETICAL message WITHOUT touching the real
  // conversation or saving — a non-destructive test of what GLM would reply (uses one API call).
  async function dryRun(msg) {
    const conv = conversation.concat([{ role: 'user', content: String(msg || '') }]);
    const recentText = conv.filter((m) => m.role !== 'system').slice(-4).map((m) => m.content || '').join('\n');
    const lc = await Constellation.engines.lore.buildLoreContext(activeLore, recentText, loreEmbedFn());
    const reqMsgs = trimForApi(toApiMessages(lc, conv));
    const { full, reasoning } = await completeGlm(reqMsgs);
    const cleaned = applyPhraseBans(full);
    return { reply: cleaned, reasoning: reasoning || undefined, bansApplied: cleaned !== full, lore: lc.items.map((it) => ({ label: it.label, text: it.text })) };
  }
  // ---- CLI bridge handlers (Shape A) — non-destructive inspection/tests ----
  function getState() {
    return { model: opts.model, thinking: !!opts.thinking, contextWindow: opts.contextWindow, messageCount: Math.max(0, conversation.length - 1), activeLore: activeLore.length, banRules: phraseBanRules.length };
  }
  async function testRetrieve(q) {
    const lc = await Constellation.engines.lore.buildLoreContext(activeLore, String(q || ''), loreEmbedFn());
    return { query: q, count: lc.items.length, items: lc.items.map((it) => ({ label: it.label, text: it.text })) };
  }
  function testBans(text) {
    const t = String(text || '');
    return { in: t, out: applyPhraseBans(t), rules: phraseBanRules.length };
  }

  // Rough token estimate (chars/4) of the messages actually sent — used for the usage tracker.
  function estTokens(msgs) {
    let c = 0;
    for (const m of msgs) { c += (m.content || '').length; if (m.reasoning_content) c += m.reasoning_content.length; }
    return Math.round(c / 4);
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

  function actionBtn(action, text) {
    const b = document.createElement('button');
    b.className = 'msg-action';
    b.type = 'button';
    b.dataset.action = action;
    b.textContent = text;
    return b;
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
    // or a saved reasoning block is being restored from disk.
    let thinkDetails = null, thinkBody = null;
    if (role === 'assistant') {
      thinkDetails = document.createElement('details');
      thinkDetails.className = 'think-block';
      thinkDetails.hidden = true;
      const sum = document.createElement('summary');
      sum.textContent = '✦ Thinking';
      thinkDetails.appendChild(sum);
      thinkBody = document.createElement('div');
      thinkBody.className = 'think-body';
      thinkDetails.appendChild(thinkBody);
      el.appendChild(thinkDetails);
      if (reasoning) {            // restore a saved thinking block (closed by default)
        thinkDetails.hidden = false;
        thinkBody.textContent = reasoning;
      }
    }

    const body = document.createElement('div');
    body.className = 'body md';
    body.innerHTML = Constellation.md.render(content);
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
    if (role === 'user') actions.appendChild(actionBtn('edit', '✎ Edit'));
    else {
      actions.appendChild(actionBtn('regen', '↻ Retry'));
      actions.appendChild(actionBtn('sculpt', '✎ Sculpt'));
    }
    actions.appendChild(actionBtn('fork', '⑂ Fork'));
    actions.appendChild(actionBtn('copy', '⎘ Copy'));
    actions.appendChild(actionBtn('bookmark', '☆'));
    el.appendChild(actions);
    applyBookmarkGlyph(el);
    if (role === 'assistant' && lore && lore.length) addLoreIndicator(el, lore);

    messagesEl.appendChild(el);
    if (!bulkScroll) { scrollToBottom(); updateJumpBtn(); updateReadProgress(); }
    return { el, body, thinkDetails, thinkBody };
  }

  function friendlyError(msg) {
    const m = String(msg || '');
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

  // Stream a fresh assistant reply. Text is revealed at a configurable flow rate
  // (opts.streamCps chars/sec; 0/Infinity = instant), markdown re-rendered on a throttle.
  // We only auto-scroll if the reader is already near the bottom.
  // Animated "thinking" dots shown in an empty reply while we wait for the first token — hides any
  // lore-processing / model-connect latency behind something that looks alive. Removed on first content.
  function showThinking(el) {
    hideThinking(el);
    const w = document.createElement('div');
    w.className = 'think-wait';
    w.setAttribute('aria-label', 'Thinking');
    w.innerHTML = '<span class="think-dot"></span><span class="think-dot"></span><span class="think-dot"></span>';
    const b = el.querySelector('.body');
    if (b && b.parentNode) b.parentNode.insertBefore(w, b.nextSibling); else el.appendChild(w);
  }
  function hideThinking(el) {
    const w = el.querySelector('.think-wait');
    if (w) w.remove();
  }

  async function streamReply(variantTarget) {
    busy = true;
    sendBtn.classList.add('stop'); sendBtn.textContent = '■'; sendBtn.title = 'Stop';

    // variantTarget = an existing assistant message to stream a NEW take into (↻ Retry);
    // otherwise this is a fresh reply appended at the end.
    let el, body, thinkDetails, thinkBody, meta, variantCi;
    if (variantTarget) {
      el = variantTarget;
      body = el.querySelector('.body');
      thinkDetails = el.querySelector('.think-block');
      thinkBody = thinkDetails ? thinkDetails.querySelector('.think-body') : null;
      meta = el.querySelector('.msg-meta');
      variantCi = convIndexForEl(el);
      body.innerHTML = ''; body.classList.add('caret'); body.style.color = '';
      if (thinkDetails) { thinkDetails.hidden = true; thinkDetails.open = false; }
      if (thinkBody) thinkBody.textContent = '';
      const oldLore = el.querySelector('.lore-used'); if (oldLore) oldLore.remove();
      el.classList.remove('continuable');
      const cont = el.querySelector('[data-action="continue"]'); if (cont) cont.remove();
    } else {
      const r = addMessage('assistant', '');
      el = r.el; body = r.body; thinkDetails = r.thinkDetails; thinkBody = r.thinkBody;
      meta = el.querySelector('.msg-meta');
      body.classList.add('caret');
    }
    setStatus('thinking…', 'ok');
    scrollToBottom();
    updateJumpBtn();
    body.classList.remove('caret');
    showThinking(el);   // animated "working" indicator while lore + the model get ready (hides any latency)

    const loreCtx = await buildLoreContext();   // relevant world context (constant + keyword + hybrid BM25/semantic passages)
    addLoreIndicator(el, loreCtx.items);
    if (window.Constellation && window.Constellation.stars) window.Constellation.stars.illuminate(loreCtx.items);   // light the sky's lore constellations

    let bodyBuf = '';
    let thinkBuf = '';
    let streaming = true;
    let revealedN = 0;
    let rafId = null;
    let lastTs = 0;
    let lastRender = 0;
    const rate = opts.streamCps > 0 ? opts.streamCps : Infinity;   // chars/sec to reveal at
    let finishAnchor = null;   // the reader's pinned line across all finish mutations (see onDone)

    function renderPrefix() {
      body.innerHTML = Constellation.md.render(applyPhraseBans(bodyBuf.slice(0, Math.floor(revealedN))));
      maybeScroll();
      updateJumpBtn();
      if (meta) updateMeta(meta, body.textContent);
    }

    function pump(ts) {
      if (lastTs === 0) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      if (revealedN < bodyBuf.length) {
        revealedN = isFinite(rate) ? Math.min(bodyBuf.length, revealedN + rate * dt) : bodyBuf.length;
        if (ts - lastRender > 40) { renderPrefix(); lastRender = ts; }
      }
      if (revealedN < bodyBuf.length || streaming) {
        rafId = requestAnimationFrame(pump);
      } else {
        body.classList.remove('caret');
        renderPrefix();
        enhanceCodeBlocks(body);   // finished streaming -> add expand/collapse toggles
        if (window.Constellation && window.Constellation.colorfx) window.Constellation.colorfx.tagColors(body);   // tag colors in the finished reply
        if (finishAnchor) restoreScrollAnchor(finishAnchor);   // final render settled — put the reader's line back
        rafId = null;
      }
    }
    rafId = requestAnimationFrame(pump);

    // For a variant regen, the request excludes the message being re-answered (it's the last turn).
    const reqSrc = variantTarget ? conversation.slice(0, variantCi) : conversation;
    const reqMsgs = trimForApi(toApiMessages(loreCtx, reqSrc));
    usage.tokens += estTokens(reqMsgs);   // count this request's tokens (context actually sent)
    usage.requests++;
    // Watchdog: a request that silently hangs (no tokens, no error) would leave busy=true forever —
    // dots looping and every action locked. Any activity resets it; 90s of silence cancels.
    let watchdog = null;
    const kickWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        cancelStream();
        streaming = false;
        busy = false;
        restoreSendBtn();
        setStatus('error', 'err');
        hideThinking(el);
        el.remove();
        if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Timed out waiting for the model — request cancelled');
      }, 90000);
    };
    kickWatchdog();
    // Snapshot the exact payload for the "what was sent" inspector (click the ◐ meter). In-memory
    // only — a reference for the curious, never persisted.
    lastRequest = {
      at: new Date().toLocaleTimeString(),
      model: opts.model || 'glm-5.3',
      opts: { temperature: opts.temperature, top_p: opts.topP, max_tokens: opts.maxTokens || '(provider default)', thinking: !!opts.thinking, effort: opts.reasoningEffort || 'max', context_window: opts.contextWindow || 0 },
      messages: reqMsgs,
    };
    currentRequest = window.api.chatStream(reqMsgs, opts, {
      onRetry: (attempt) => setStatus('retrying… (attempt ' + attempt + ')', 'ok'),
      onThink: (delta) => {
        hideThinking(el);
        kickWatchdog();
        thinkBuf += delta;
        if (thinkDetails) {
          thinkDetails.hidden = false;
          thinkDetails.open = true;
          if (thinkBody) thinkBody.textContent = thinkBuf;
        }
      },
      onChunk: (delta) => {
        hideThinking(el);
        kickWatchdog();
        if (!body.classList.contains('caret')) body.classList.add('caret');
        bodyBuf += delta;
        if (statusEl.textContent !== 'writing…') setStatus('writing…', 'ok');
      },
      onDone: (full, finishReason) => {
        hideThinking(el);
        clearTimeout(watchdog);
        finishAnchor = (!atBottom()) ? captureScrollAnchor() : null;   // pin the reader's line BEFORE any finish mutations
        streaming = false;
        if (full) bodyBuf = full;
        bodyBuf = applyPhraseBans(bodyBuf);   // tidy banned phrases out of the final reply (model never sees the list)
        el.__raw = bodyBuf;   // the streamed reply's raw source was never set (placeholder was '') — copy/edit need it
        if (window.Constellation.mood) window.Constellation.mood.assess(bodyBuf || thinkBuf);   // the sky weathers the story
        const vLore = loreCtx && loreCtx.items.length ? loreCtx.items.map((it) => ({ label: it.label, text: String(it.text || '').slice(0, 300) })) : undefined;
        if (variantTarget) {
          // Keep the prior take(s); add this one and make it the active variant.
          const m = conversation[variantCi];
          if (m) {
            if (!Array.isArray(m.variants)) m.variants = [{ content: m.content || '', reasoning: m.reasoning, lore: m.lore }];
            m.variants.push({ content: bodyBuf, reasoning: thinkBuf || undefined, lore: vLore });
            m.vActive = m.variants.length - 1;
            m.content = bodyBuf; m.reasoning = thinkBuf || undefined; m.lore = vLore;
          }
        } else {
          conversation.push({ role: 'assistant', content: bodyBuf, reasoning: thinkBuf || undefined, lore: vLore });
        }
        if (thinkDetails && thinkBuf && atBottom()) thinkDetails.open = false;   // fold thinking away once the answer is in — but NOT while the reader is scrolled up (the collapse would yank their view)
        if (finishReason === 'length') {   // hit the max-length cap -> offer to continue from the cutoff
          el.classList.add('continuable');
          const acts = el.querySelector('.msg-actions');
          if (acts && !acts.querySelector('[data-action="continue"]')) acts.appendChild(actionBtn('continue', '↪ Continue'));
        }
        busy = false;
        restoreSendBtn();
        setStatus('connected', 'ok');
        updateContextMeter();
        inputEl.focus();
        usage.tokens += Math.round(((full || bodyBuf).length + (thinkBuf || '').length) / 4);   // count the reply's tokens too
        if (window.Constellation && window.Constellation.sessions) {
          window.Constellation.sessions.saveCurrent(conversation.slice(1), roleplayPrompt, projectInstructions, genSnapshot(), usage, systemFiles, projectFiles);   // persist the chat + instructions + settings + usage + files
        }
        if (variantTarget) renderVariantNav(el);
        if (finishAnchor) { restoreScrollAnchor(finishAnchor); requestAnimationFrame(() => restoreScrollAnchor(finishAnchor)); }
        if (!rafId) rafId = requestAnimationFrame(pump);   // flush any buffered tail at the flow rate
      },
      onError: (message) => {
        hideThinking(el);
        clearTimeout(watchdog);
        streaming = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        const friendly = friendlyError(message);
        if (window.Constellation && window.Constellation.toast) window.Constellation.toast(friendly);
        if (variantTarget) {
          renderActiveVariant(el);   // regen failed — restore the existing active take
        } else {
          el.remove();   // remove the placeholder entirely: an error bubble with no conversation
                         // entry desynced every index-based operation after it (edit/fork/bookmarks)
        }
        busy = false;
        restoreSendBtn();
        setStatus('error', 'err');
        inputEl.focus();
      },
    });
  }

  async function send() {
    const text = inputEl.value.trim();
    const files = pendingFiles.slice();
    if ((!text && !files.length) || busy) return;
    pendingFiles = [];
    renderChips();
    addMessage('user', text, files);
    conversation.push({ role: 'user', content: text, files: files.length ? files : undefined });
    inputEl.value = '';
    autoGrow();
    updateContextMeter();
    if (window.Constellation && window.Constellation.sessions && window.Constellation.sessions.saveDraft) window.Constellation.sessions.saveDraft('');   // sent -> clear the draft
    sendBtn.classList.add('pulse');
    setTimeout(() => sendBtn.classList.remove('pulse'), 500);
    streamReply();
  }

  // Stop the in-flight stream (keeps whatever was already generated).
  function cancelStream() {
    if (currentRequest && window.api && window.api.cancelStream) {
      try { window.api.cancelStream(currentRequest); } catch (e) {}
    }
  }
  function restoreSendBtn() {
    sendBtn.classList.remove('stop');
    sendBtn.textContent = '➤';
    sendBtn.title = 'Send (Enter)';
    currentRequest = null;
  }
  // Copy a message's raw markdown source (falls back to visible text).
  function copyMessage(el) {
    const body = el.querySelector('.body');
    // NOTE: a freshly-streamed reply's element is created with __raw='' — empty must fall through
    // to the rendered text, or long fresh replies copy as blank (the old "hit or miss").
    const text = el.__raw ? el.__raw : (body ? body.textContent : '');
    if (window.api && window.api.writeClipboard) window.api.writeClipboard(text);   // main-process clipboard (handles large text reliably)
    const btn = el.querySelector('[data-action="copy"]');
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = orig; }, 1200); }
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
    streamReply();
  }

  // ---- per-message actions: edit (user) / regenerate (assistant) ----

  function onMessageClick(e) {
    const btn = e.target.closest('.msg-action');
    if (!btn) return;
    const el = e.target.closest('.msg');
    if (!el || busy) return;
    if (messagesEl.querySelector('.msg[data-editing="1"]')) return;   // an edit is already open
    const action = btn.dataset.action;
    if (action === 'edit') startEdit(el);
    else if (action === 'sculpt') startSculpt(el);
    else if (action === 'regen') regenerate(el);
    else if (action === 'fork') forkFromEl(el);
    else if (action === 'copy') copyMessage(el);
    else if (action === 'bookmark') toggleBookmark(el);
    else if (action === 'continue') continueReply(el);
  }

  // Branch a NEW chat off the clicked message: snapshot the conversation up to and including it
  // (the current chat is untouched) and hand it to sessions to create the fork.
  function forkFromEl(el) {
    const msgs = Array.from(messagesEl.querySelectorAll('.msg'));
    const idx = msgs.indexOf(el);
    if (idx === -1) return;
    // conversation[0] is the system message (no DOM element), so DOM idx -> conversation[idx+1].
    const prefix = conversation.slice(1, idx + 2)
      .map((m) => ({ role: m.role, content: m.content, files: m.files, reasoning: m.reasoning }));
    if (window.Constellation && window.Constellation.sessions && window.Constellation.sessions.forkFrom) {
      window.Constellation.sessions.forkFrom({ messages: prefix, system: roleplayPrompt, project: projectInstructions, gen: genSnapshot() });
    }
  }

  function truncateFromEl(el) {
    const msgs = Array.from(messagesEl.querySelectorAll('.msg'));
    const idx = msgs.indexOf(el);
    if (idx === -1) return;
    for (let i = msgs.length - 1; i >= idx; i--) msgs[i].remove();
    conversation.length = idx + 1;
  }
  // conversation[0] is the system message (no DOM node), so a .msg at DOM index i is conversation[i+1].
  function convIndexForEl(el) {
    const msgs = Array.from(messagesEl.querySelectorAll('.msg'));
    return msgs.indexOf(el) + 1;
  }
  // Remove messages strictly AFTER el (keep el) — used when re-rolling a reply, so anything that
  // followed it (responses to the old take) is dropped while the message itself stays for variants.
  function truncateAfterEl(el) {
    const msgs = Array.from(messagesEl.querySelectorAll('.msg'));
    const idx = msgs.indexOf(el);
    if (idx === -1) return;
    for (let i = msgs.length - 1; i > idx; i--) msgs[i].remove();
    conversation.length = idx + 2;   // keep through conversation[idx+1] (= msgs[idx] = el)
  }

  function startEdit(el) {
    const body = el.querySelector('.body');
    if (!body || el.dataset.editing === '1') return;
    const original = (el.__raw != null ? el.__raw : body.textContent);   // edit the raw markdown source
    el.dataset.editing = '1';
    el.classList.add('editing');   // widen the bubble so the edit box has room

    const ta = document.createElement('textarea');
    ta.className = 'edit-area';
    ta.value = original;
    body.replaceChildren(ta);

    // Size the edit box to fit its contents and keep growing as you type.
    const growEdit = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.6)) + 'px';
    };
    ta.addEventListener('input', growEdit);
    growEdit();
    requestAnimationFrame(growEdit);

    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    const save = actionBtn('commit', 'Save & resend');
    const cancel = actionBtn('cancel', 'Cancel');
    bar.appendChild(save);
    bar.appendChild(cancel);
    el.querySelector('.msg-actions').replaceWith(bar);

    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    save.addEventListener('click', () => {
      const v = ta.value.trim();
      const files = el.__files || [];   // keep the message's existing attachments on resend
      el.dataset.editing = '';
      if (!v && !files.length) { restoreMessage(el, original); return; }
      truncateFromEl(el);
      addMessage('user', v, files);
      conversation.push({ role: 'user', content: v, files: files.length ? files : undefined });
      streamReply();
    });
    cancel.addEventListener('click', () => restoreMessage(el, original));
  }

  function restoreMessage(el, original) {
    el.dataset.editing = '';
    el.classList.remove('editing');
    const body = el.querySelector('.body');
    if (body) { body.classList.add('md'); body.innerHTML = Constellation.md.render(original); enhanceCodeBlocks(body); }
    const bar = el.querySelector('.edit-bar');
    if (bar) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.appendChild(actionBtn('edit', '✎ Edit'));
      actions.appendChild(actionBtn('fork', '⑂ Fork'));
      actions.appendChild(actionBtn('copy', '⎘ Copy'));
      actions.appendChild(actionBtn('bookmark', '☆'));
      bar.replaceWith(actions);
      applyBookmarkGlyph(el);
    }
  }

  // ---- sculpt: edit the model's prose in place. No resend, nothing after it changes — the
  // conversation (and the model's future context) simply carries your wording from here on.
  // The model's original is kept on the message (m.orig) so the edit can be studied, and so an
  // optional "teach from edits" mode can show the model how you bend its voice.
  function startSculpt(el) {
    const body = el.querySelector('.body');
    if (!body || el.dataset.editing === '1') return;
    const original = (el.__raw != null ? el.__raw : body.textContent);
    el.dataset.editing = '1';
    el.classList.add('editing');

    const ta = document.createElement('textarea');
    ta.className = 'edit-area';
    ta.value = original;
    body.replaceChildren(ta);
    const growEdit = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.6)) + 'px';
    };
    ta.addEventListener('input', growEdit);
    growEdit();

    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    const save = actionBtn('commit', 'Save sculpted prose');
    const cancel = actionBtn('cancel', 'Cancel');
    bar.appendChild(save);
    bar.appendChild(cancel);
    el.querySelector('.msg-actions').replaceWith(bar);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    save.addEventListener('click', () => {
      const v = ta.value.trim();
      const m = conversation[convIndexForEl(el)];
      if (!m) { restoreSculpt(el, original); return; }
      if (v && v !== original) {
        if (!m.orig) m.orig = original;   // first take stays on record; re-sculpts just move the target
        m.content = v;
        m.edited = true;
        if (Array.isArray(m.variants) && m.variants[m.vActive || 0]) m.variants[m.vActive || 0].content = v;
      }
      persist();
      renderSculpted(el, v || original, !!(m && m.edited));
    });
    cancel.addEventListener('click', () => restoreSculpt(el, original));
  }
  function restoreSculpt(el, original) {
    el.dataset.editing = '';
    el.classList.remove('editing');
    const m = conversation[convIndexForEl(el)];
    renderSculpted(el, original, !!(m && m.edited));
  }
  function renderSculpted(el, content, edited) {
    el.__raw = content;
    const body = el.querySelector('.body');
    if (body) {
      body.classList.add('md');
      body.innerHTML = Constellation.md.render(content);
      enhanceCodeBlocks(body);
      if (window.Constellation && window.Constellation.colorfx) window.Constellation.colorfx.tagColors(body);
    }
    const bar = el.querySelector('.edit-bar');
    if (bar) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.appendChild(actionBtn('regen', '↻ Retry'));
      actions.appendChild(actionBtn('sculpt', '✎ Sculpt'));
      actions.appendChild(actionBtn('fork', '⑂ Fork'));
      actions.appendChild(actionBtn('copy', '⎘ Copy'));
      actions.appendChild(actionBtn('bookmark', '☆'));
      bar.replaceWith(actions);
      applyBookmarkGlyph(el);
    }
    const metaEl = el.querySelector('.msg-meta');
    if (metaEl) updateMeta(metaEl, body ? body.textContent : '', edited);
  }

  function regenerate(el) {
    if (busy) return;
    truncateAfterEl(el);   // keep this reply, drop anything after it; we're adding another take
    streamReply(el);
  }

  // ---- regenerate variants: keep multiple takes of a reply, flip between them ----
  // Re-render a message's active variant (content + thinking + meta + lore log + nav).
  function renderActiveVariant(el) {
    const m = conversation[convIndexForEl(el)];
    if (!m) return;
    el.__raw = m.content || '';   // keep copy/edit on the active variant's raw source
    const body = el.querySelector('.body');
    if (body) { body.classList.remove('caret'); body.style.color = ''; body.innerHTML = Constellation.md.render(m.content || ''); enhanceCodeBlocks(body); }
    const think = el.querySelector('.think-block');
    if (think) {
      if (m.reasoning) { think.hidden = false; think.open = false; const tb = think.querySelector('.think-body'); if (tb) tb.textContent = m.reasoning; }
      else think.hidden = true;
    }
    const metaEl = el.querySelector('.msg-meta'); if (metaEl) updateMeta(metaEl, body ? body.textContent : '', !!m.edited);
    const oldLore = el.querySelector('.lore-used'); if (oldLore) oldLore.remove();
    if (m.lore && m.lore.length) addLoreIndicator(el, m.lore);
    renderVariantNav(el);
  }
  // Add/refresh the ‹ n/total › control (only shown when there's more than one take).
  function renderVariantNav(el) {
    const m = conversation[convIndexForEl(el)];
    if (!m || !Array.isArray(m.variants) || m.variants.length < 2) { const nav = el.querySelector('.variant-nav'); if (nav) nav.remove(); return; }
    let nav = el.querySelector('.variant-nav');
    if (!nav) {
      nav = document.createElement('div'); nav.className = 'variant-nav';
      const prev = document.createElement('button'); prev.type = 'button'; prev.className = 'variant-arrow'; prev.textContent = '‹'; prev.title = 'Previous take';
      prev.addEventListener('click', () => switchVariant(el, -1));
      const label = document.createElement('span'); label.className = 'variant-label';
      const next = document.createElement('button'); next.type = 'button'; next.className = 'variant-arrow'; next.textContent = '›'; next.title = 'Next take';
      next.addEventListener('click', () => switchVariant(el, 1));
      nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next);
      const acts = el.querySelector('.msg-actions');
      if (acts) el.insertBefore(nav, acts); else el.appendChild(nav);
    }
    nav.querySelector('.variant-label').textContent = ((m.vActive || 0) + 1) + '/' + m.variants.length;
  }
  function switchVariant(el, dir) {
    if (busy) return;
    const m = conversation[convIndexForEl(el)];
    if (!m || !Array.isArray(m.variants) || m.variants.length < 2) return;
    let n = (m.vActive || 0) + dir;
    if (n < 0) n = m.variants.length - 1;
    if (n >= m.variants.length) n = 0;
    m.vActive = n;
    const v = m.variants[n] || {};
    m.content = v.content || ''; m.reasoning = v.reasoning; m.lore = v.lore;   // mirror active → what gets sent/continued
    renderActiveVariant(el);
    persist();
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
    conversation = [{ role: 'system', content: buildSystem() }];
    usage = { tokens: 0, requests: 0 };
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
  function loadSession(msgs, system, project, gen, incomingUsage, systemFiles, projectFiles) {
    if (system !== undefined || project !== undefined) setPrompts({ roleplay: system, project, systemFiles, projectFiles });
    if (gen) setOptions(gen);   // restore THIS chat's generation settings
    const swap = () => {
      reset();
      usage = incomingUsage || { tokens: 0, requests: 0 };   // restore this chat's cumulative usage
      bulkScroll = true;
      const turns = (msgs || []).filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content, files: m.files, reasoning: m.reasoning, lore: m.lore, edited: m.edited, orig: m.orig, variants: m.variants, vActive: m.vActive }));
      conversation = [{ role: 'system', content: buildSystem() }].concat(turns);
      for (const m of turns) {
        const r = addMessage(m.role, m.content, m.files, m.reasoning, m.lore, { edited: m.edited });
        if (m.role === 'assistant' && Array.isArray(m.variants) && m.variants.length > 1 && r && r.el) renderVariantNav(r.el);
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
  function getPrompts() { return { roleplay: roleplayPrompt, project: projectInstructions, systemFiles, projectFiles }; }

  // The active chat's generation settings — Settings + Craft read these so they reflect THIS chat.
  function getOptions() { return Object.assign({}, opts); }

  // The per-chat gen bundle that gets persisted with the session. ONLY the model is per-chat —
  // freezing thinking/effort/etc here meant Settings changes silently never reached existing
  // chats (chats stuck on a stale effort was the "thinking got shorter" bug).
  function genSnapshot() {
    return { model: opts.model };
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

  return { init, setPrompts, getPrompts, getOptions, persist, setOptions, setActiveLore, setPhraseBans, setDraft, scrollToMatch, scrollToMessage, refreshBookmarkGlyphs, reset, loadSession, getUserWriting, recentMessages, getState, testRetrieve, testBans, dryRun };
})();
