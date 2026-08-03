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
  let bulkScroll = false;      // suppress per-message auto-scroll while bulk-rendering a chat
  let usage = { tokens: 0, requests: 0 };   // cumulative estimated tokens for the current chat
  let pendingFiles = [];   // [{ name, size, text }] queued attachments for the next send
  let opts = { model: 'glm-5.2', temperature: 0.8, topP: 0.95, maxTokens: 0, thinking: false, reasoningEffort: 'max', streamCps: 0, contextWindow: 0 };

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
  function updateMeta(metaEl, text) {
    if (!metaEl) return;
    const t = String(text || '').trim();
    const words = t ? t.split(/\s+/).filter(Boolean).length : 0;
    metaEl.textContent = words + ' words · ' + t.length + ' chars';
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
    ctxMeter.title = trimming ? ('Sending last ~' + fmt(sent) + ' of ' + fmt(total) + ' tokens (context window on)')
                              : ('Estimated conversation size');
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

  function buildSystem() {
    return [
      roleplayPrompt,
      projectInstructions && ('# Project instructions\n' + projectInstructions),
    ].filter(Boolean).join('\n\n');
  }

  function setPrompts({ roleplay, project }) {
    if (roleplay !== undefined) roleplayPrompt = (roleplay || '').trim();
    if (project !== undefined) projectInstructions = (project || '').trim();
    const sys = buildSystem();
    if (conversation[0] && conversation[0].role === 'system') conversation[0].content = sys;
    else conversation.unshift({ role: 'system', content: sys });
  }

  function setOptions(patch) {
    if (patch) Object.assign(opts, patch);
    if (topModel && opts.model) topModel.value = opts.model;   // keep the top-bar switcher in sync
  }

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
    opts.streamCps = cfg.streamCps ?? 0;
    opts.contextWindow = cfg.contextWindow ?? 0;
    if (cfg.hasKey) setStatus('connected · ' + (cfg.model || 'glm-5.2'), 'ok');
    else setStatus('add your API key in Settings', 'err');

    bind();
  }

  function bind() {
    sendBtn.addEventListener('click', () => { if (busy) cancelStream(); else send(); });
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
      setStatus('connected · ' + model, 'ok');
      persist();   // model is per-chat -> save it with this chat
    });
    autoGrow();
    messagesEl.addEventListener('click', onMessageClick);
    messagesEl.addEventListener('scroll', () => { updateJumpBtn(); updateReadProgress(); }, { passive: true });
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
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(160, inputEl.scrollHeight) + 'px';
  }

  // ---- File attachments (markdown/text read as context for the model) ----
  function formatCount(n) {
    if (n >= 1000) return (Math.round(n / 100) / 10) + 'k chars';
    return n + ' chars';
  }

  // Builds a chip element. removable=true -> shows an × (pending in the composer).
  function fileChipEl(f, removable) {
    const chip = document.createElement('div');
    const big = f.text != null && f.text.length > 50000;
    chip.className = 'attach-chip' + (big ? ' large' : '');
    const ico = document.createElement('span'); ico.className = 'attach-ico'; ico.textContent = '📄';
    const nm = document.createElement('span'); nm.className = 'attach-name'; nm.textContent = f.name;
    const sz = document.createElement('span');
    sz.className = 'attach-size';
    sz.textContent = formatCount(f.text != null ? f.text.length : (f.size || 0));
    chip.appendChild(ico); chip.appendChild(nm); chip.appendChild(sz);
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
      const reader = new FileReader();
      reader.onload = () => {
        pendingFiles.push({ name: file.name, size: file.size, text: String(reader.result || '') });
        done();
      };
      reader.onerror = done;
      reader.readAsText(file);
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
  function toApiMessages() {
    const preserve = !!opts.thinking;
    return conversation.map((m) => {
      if (m.role === 'user' && m.files && m.files.length) {
        return { role: 'user', content: composeUserContent(m) };
      }
      const out = { role: m.role, content: m.content };
      if (preserve && m.role === 'assistant' && m.reasoning) out.reasoning_content = m.reasoning;
      return out;
    });
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
        try { navigator.clipboard.writeText(pre.textContent || ''); } catch (e) {}
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

  function addMessage(role, content, files, reasoning) {
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
    el.appendChild(body);

    // Attachment chips shown inside the message bubble (display only).
    if (files && files.length) {
      const fc = document.createElement('div');
      fc.className = 'msg-files';
      for (const f of files) fc.appendChild(fileChipEl(f, false));
      el.appendChild(fc);
    }

    // Word/char count under responses (assistant only).
    if (role === 'assistant') {
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      updateMeta(meta, body.textContent);
      el.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    if (role === 'user') actions.appendChild(actionBtn('edit', '✎ Edit'));
    else actions.appendChild(actionBtn('regen', '↻ Retry'));
    actions.appendChild(actionBtn('fork', '⑂ Fork'));
    actions.appendChild(actionBtn('copy', '⎘ Copy'));
    el.appendChild(actions);

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
    return m;
  }

  // Stream a fresh assistant reply. Text is revealed at a configurable flow rate
  // (opts.streamCps chars/sec; 0/Infinity = instant), markdown re-rendered on a throttle.
  // We only auto-scroll if the reader is already near the bottom.
  function streamReply() {
    busy = true;
    sendBtn.classList.add('stop'); sendBtn.textContent = '■'; sendBtn.title = 'Stop';

    const { el, body, thinkDetails, thinkBody } = addMessage('assistant', '');
    const meta = el.querySelector('.msg-meta');
    body.classList.add('caret');
    setStatus('thinking…', 'ok');
    scrollToBottom();
    updateJumpBtn();

    let bodyBuf = '';
    let thinkBuf = '';
    let streaming = true;
    let revealedN = 0;
    let rafId = null;
    let lastTs = 0;
    let lastRender = 0;
    const rate = opts.streamCps > 0 ? opts.streamCps : Infinity;   // chars/sec to reveal at

    function renderPrefix() {
      body.innerHTML = Constellation.md.render(bodyBuf.slice(0, Math.floor(revealedN)));
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
        rafId = null;
      }
    }
    rafId = requestAnimationFrame(pump);

    const reqMsgs = trimForApi(toApiMessages());
    usage.tokens += estTokens(reqMsgs);   // count this request's tokens (context actually sent)
    usage.requests++;
    currentRequest = window.api.chatStream(reqMsgs, opts, {
      onRetry: (attempt) => setStatus('retrying… (attempt ' + attempt + ')', 'ok'),
      onThink: (delta) => {
        thinkBuf += delta;
        if (thinkDetails) {
          thinkDetails.hidden = false;
          thinkDetails.open = true;
          if (thinkBody) thinkBody.textContent = thinkBuf;
        }
      },
      onChunk: (delta) => {
        bodyBuf += delta;
        if (statusEl.textContent !== 'writing…') setStatus('writing…', 'ok');
      },
      onDone: (full, finishReason) => {
        streaming = false;
        if (full) bodyBuf = full;
        conversation.push({ role: 'assistant', content: bodyBuf, reasoning: thinkBuf || undefined });
        if (thinkDetails && thinkBuf) thinkDetails.open = false;   // fold thinking away once the answer is in
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
          window.Constellation.sessions.saveCurrent(conversation.slice(1), roleplayPrompt, projectInstructions, genSnapshot(), usage);   // persist the chat + instructions + settings + usage
        }
        if (!rafId) rafId = requestAnimationFrame(pump);   // flush any buffered tail at the flow rate
      },
      onError: (message) => {
        streaming = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        body.classList.remove('caret');
        revealedN = bodyBuf.length;
        body.textContent = '⚠ ' + friendlyError(message);
        body.style.color = 'var(--danger)';
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
    const text = el.__raw != null ? el.__raw : (body ? body.textContent : '');
    try { navigator.clipboard.writeText(text); } catch (e) {}
    const btn = el.querySelector('[data-action="copy"]');
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = orig; }, 1200); }
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
    else if (action === 'regen') regenerate(el);
    else if (action === 'fork') forkFromEl(el);
    else if (action === 'copy') copyMessage(el);
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
      bar.replaceWith(actions);
    }
  }

  function regenerate(el) {
    if (busy) return;
    truncateFromEl(el);
    streamReply();
  }

  // Start a fresh empty chat (keeps the current system prompt + project instructions).
  function reset() {
    conversation = [{ role: 'system', content: buildSystem() }];
    usage = { tokens: 0, requests: 0 };
    pendingFiles = [];
    renderChips();
    messagesEl.replaceChildren();
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    const t = document.createElement('div'); t.className = 'empty-hint-title'; t.textContent = 'The sky is quiet.';
    const s = document.createElement('div'); s.className = 'empty-hint-sub'; s.textContent = 'Write something to begin.';
    hint.appendChild(t); hint.appendChild(s);
    messagesEl.appendChild(hint);
    setStatus('connected · ' + opts.model, 'ok');
    updateContextMeter();
    updateReadProgress();
  }

  // Load a saved chat. Its own system + project instructions are restored first, so the system
  // message reflects THIS chat (not whichever chat was loaded last).
  // Load a saved chat. The DOM swap runs inside a View Transition so the old thread dissolves into
  // the new one (a real crossfade, not a dip-to-black). Per-message auto-scroll is suppressed during
  // the bulk render so there's no vertical snap; we land once at the latest message.
  function loadSession(msgs, system, project, gen, incomingUsage) {
    if (system !== undefined || project !== undefined) setPrompts({ roleplay: system, project });
    if (gen) setOptions(gen);   // restore THIS chat's generation settings
    const swap = () => {
      reset();
      usage = incomingUsage || { tokens: 0, requests: 0 };   // restore this chat's cumulative usage
      bulkScroll = true;
      const turns = (msgs || []).filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content, files: m.files, reasoning: m.reasoning }));
      conversation = [{ role: 'system', content: buildSystem() }].concat(turns);
      for (const m of turns) addMessage(m.role, m.content, m.files, m.reasoning);
      bulkScroll = false;
      scrollToBottom();           // land at the latest message in one move (no top→bottom snap)
      updateJumpBtn(); updateReadProgress();
      setStatus('connected · ' + opts.model, 'ok');
      updateContextMeter();
    };
    if (document.startViewTransition) document.startViewTransition(swap);   // crossfade where supported
    else swap();                                                             // plain instant swap fallback
  }

  // The active chat's instructions — Settings reads these so the editors show what THIS chat uses.
  function getPrompts() { return { roleplay: roleplayPrompt, project: projectInstructions }; }

  // The active chat's generation settings — Settings + Craft read these so they reflect THIS chat.
  function getOptions() { return Object.assign({}, opts); }

  // The per-chat gen bundle that gets persisted with the session.
  function genSnapshot() {
    return {
      model: opts.model, temperature: opts.temperature, topP: opts.topP,
      maxTokens: opts.maxTokens, thinking: opts.thinking, reasoningEffort: opts.reasoningEffort,
      streamCps: opts.streamCps, contextWindow: opts.contextWindow,
    };
  }

  // Persist the current chat (messages + instructions + settings) now — used when you edit
  // instructions or generation in Settings without sending a new message.
  function persist() {
    if (conversation.length > 1 && window.Constellation && window.Constellation.sessions) {
      window.Constellation.sessions.saveCurrent(conversation.slice(1), roleplayPrompt, projectInstructions, genSnapshot(), usage);
    }
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

  return { init, setPrompts, getPrompts, getOptions, persist, setOptions, setDraft, scrollToMatch, reset, loadSession, getUserWriting };
})();
