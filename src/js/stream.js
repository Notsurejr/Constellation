// Stream: the send→wire→reveal pipeline — watchdog, typewriter pump, streaming ink,
// finish-render (anchors, phrase bans, code toggles, color words), and the per-stream
// lifecycle (variants, continue buttons, persist, tokenizer).
//
// STATE STAYS IN CHAT: this module receives everything through an explicit hooks object
// at init (chat.init calls stream.init(H)). Per-STREAM state (buffers, reveal cursor,
// watchdog timer, finish anchor) lives inside streamReply — it is born and dies with the
// request. Extracted from chat.js in the module split (step 3); compose and sculpt are
// reached globally.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.stream = (function () {
  let H = null;   // hooks — set once by chat.init
  function init(hooks) { H = hooks; }

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

  // Streaming ink: wrap the trailing words in the materialize animation with an inline
  // NEGATIVE delay equal to each word's age behind the reveal cursor — rebuilt nodes resume
  // the keyframe mid-flight instead of restarting (the 40ms re-render would reset them).
  function inkEdge(body, cps) {
    const win = Math.max(24, Math.ceil(cps * 0.55));   // only words younger than ~550ms
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    const tails = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const p = n.parentElement;
      if (!p) continue;
      const tag = p.tagName.toLowerCase();
      if (tag === 'code' || tag === 'pre' || p.classList.contains('tok-in')) continue;
      tails.push(n);
      if (tails.length > 40) tails.shift();
    }
    let dist = 0;   // rendered chars from the very end of the reply-so-far
    for (let i = tails.length - 1; i >= 0 && dist < win; i--) {
      const n = tails[i];
      const parts = n.textContent.split(/(\s+)/);
      const frag = document.createDocumentFragment();
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j];
        if (!p) continue;
        if (/^\s+$/.test(p)) { frag.insertBefore(document.createTextNode(p), frag.firstChild); dist += p.length; continue; }
        const ageMs = Math.round((dist / cps) * 1000);
        if (ageMs < 480) {
          const s = document.createElement('span');
          s.className = 'tok-in';
          s.style.animationDelay = '-' + ageMs + 'ms';
          s.textContent = p;
          frag.insertBefore(s, frag.firstChild);
        } else {
          frag.insertBefore(document.createTextNode(p), frag.firstChild);
        }
        dist += p.length;
        if (dist >= win) {
          for (let k = j - 1; k >= 0; k--) if (parts[k]) frag.insertBefore(document.createTextNode(parts[k]), frag.firstChild);
          break;
        }
      }
      n.parentNode.replaceChild(frag, n);
    }
  }

  async function streamReply(variantTarget) {
    H.setBusy(true);
    H.sendBtn().classList.add('stop'); H.sendBtn().textContent = '■'; H.sendBtn().title = 'Stop';

    // variantTarget = an existing assistant message to stream a NEW take into (↻ Retry);
    // otherwise this is a fresh reply appended at the end.
    let el, body, thinkDetails, thinkBody, meta, variantCi;
    if (variantTarget) {
      el = variantTarget;
      body = el.querySelector('.body');
      thinkDetails = el.querySelector('.think-block');
      thinkBody = thinkDetails ? thinkDetails.querySelector('.think-body') : null;
      meta = el.querySelector('.msg-meta');
      variantCi = Constellation.sculpt.convIndexForEl(el);
      body.innerHTML = ''; body.classList.add('caret'); body.style.color = '';
      if (thinkDetails) { thinkDetails.hidden = true; thinkDetails.open = false; }
      if (thinkBody) thinkBody.textContent = '';
      const oldLore = el.querySelector('.lore-used'); if (oldLore) oldLore.remove();
      el.classList.remove('continuable');
      const cont = el.querySelector('[data-action="continue"]'); if (cont) cont.remove();
    } else {
      const r = H.addMessage('assistant', '');
      el = r.el; body = r.body; thinkDetails = r.thinkDetails; thinkBody = r.thinkBody;
      meta = el.querySelector('.msg-meta');
      body.classList.add('caret');
    }
    H.setStatus('thinking…', 'ok');
    H.maybeScroll();   // follow only if reading at the bottom — regen/continue from mid-read must not snap
    H.updateJumpBtn();
    body.classList.remove('caret');
    showThinking(el);   // animated "working" indicator while lore + the model get ready (hides any latency)

    const loreCtx = await H.buildLoreContext();   // relevant world context (constant + keyword + hybrid BM25/semantic passages)
    H.addLoreIndicator(el, loreCtx.items);
    if (window.Constellation && window.Constellation.stars) window.Constellation.stars.illuminate(loreCtx.items);   // light the sky's lore constellations

    let bodyBuf = '';
    let thinkBuf = '';
    let streaming = true;
    let revealedN = 0;
    let rafId = null;
    let lastTs = 0;
    let lastRender = 0;
    const rate = H.getOpts().streamCps > 0 ? H.getOpts().streamCps : Infinity;   // chars/sec to reveal at
    let finishAnchor = null;   // the reader's pinned line across all finish mutations (see onDone)

    function renderPrefix(ink, live) {
      body.innerHTML = H.renderBodyHTML(H.applyPhraseBans(bodyBuf.slice(0, Math.floor(revealedN))), { streaming: !!live });
      if (ink && H.getOpts().streamInk && isFinite(rate)) inkEdge(body, rate);
      H.maybeScroll();
      H.updateJumpBtn();
      if (meta) H.updateMeta(meta, body.textContent);
    }

    function pump(ts) {
      if (lastTs === 0) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      if (revealedN < bodyBuf.length) {
        revealedN = isFinite(rate) ? Math.min(bodyBuf.length, revealedN + rate * dt) : bodyBuf.length;
        if (ts - lastRender > 40) { renderPrefix(true, true); lastRender = ts; }
      }
      if (revealedN < bodyBuf.length || streaming) {
        rafId = requestAnimationFrame(pump);
      } else {
        const _diagT0 = performance.now();
        const pinned = !finishAnchor && H.atBottom();   // bottom-pinned readers: the final re-parse can shift content height — keep their eye on the same text
        const prevH = H.messagesEl().scrollHeight;
        body.classList.remove('caret');
        renderPrefix(false, false);
        H.enhanceCodeBlocks(body);   // finished streaming -> add expand/collapse toggles
        if (window.Constellation && window.Constellation.colorfx) window.Constellation.colorfx.tagColors(body);   // tag colors in the finished reply
        if (finishAnchor) H.restoreScrollAnchor(finishAnchor);   // final render settled — put the reader's line back
        else if (pinned) {
          const dH = H.messagesEl().scrollHeight - prevH;
          H.messagesEl().scrollTop += dH;   // compensate the height shift instead of hard re-pinning (the old visible jump)
          if (window.Constellation && window.Constellation.diag) window.Constellation.diag.note('re-pin', 'dH ' + Math.round(dH));   // scroll-capture correlation
        }
        if (window.Constellation && window.Constellation.diag) window.Constellation.diag.span('finish-render', performance.now() - _diagT0);
        rafId = null;
      }
    }
    rafId = requestAnimationFrame(pump);

    // For a variant regen, the request excludes the message being re-answered (it's the last turn).
    const reqSrc = variantTarget ? H.getConv().slice(0, variantCi) : H.getConv();
    const _diagT0 = performance.now();
    const opts = H.getOpts();
    const reqMsgs = Constellation.compose.trimForApi(opts.contextWindow, Constellation.compose.toApiMessages(opts, H.projectInstructions(), loreCtx, reqSrc));
    if (window.Constellation && window.Constellation.diag) window.Constellation.diag.span('compose', performance.now() - _diagT0);
    const seed = H.takePrefill();   // capture + clear: the drawer is strictly one-shot
    if (seed) {
      // "Lead its thinking": the array ends with a partial assistant turn carrying OUR reasoning
      // seed and no prose — the model is invited to continue a thought we chose. (Tested verdict:
      // GLM currently accepts but ignores reasoning seeds; kept for the user's own experiments.
      // The seed is also prepended to the stored reasoning, so a prefill becomes tomorrow's steer.)
      reqMsgs.push({ role: 'assistant', content: '', reasoning_content: seed });
    }
    H.addUsageTokens(Constellation.compose.estTokens(reqMsgs));   // count this request's tokens (context actually sent)
    H.addUsageRequest();
    // Watchdog: a request that silently hangs (no tokens, no error) would leave busy=true forever —
    // dots looping and every action locked. Any activity resets it. Slow reasoners (Gemini's
    // compat door) think silently server-side before the FIRST byte, so the pre-first-byte
    // allowance is long (420s); once anything flows, 90s between chunks still catches dead hangs.
    let watchdog = null;
    let streamStarted = false;
    const kickWatchdog = () => {
      clearTimeout(watchdog);
      const ms = streamStarted ? 90000 : 420000;
      watchdog = setTimeout(() => {
        H.cancelStream();
        streaming = false;
        H.setBusy(false);
        H.restoreSendBtn();
        H.setStatus('error', 'err', 'Timed out after ' + Math.round(ms / 1000) + 's with no data from the model — request cancelled.');
        hideThinking(el);
        el.remove();
        if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Timed out waiting for the model — request cancelled', 9000);
      }, ms);
    };
    kickWatchdog();
    // Snapshot the exact payload for the "what was sent" inspector (click the ◐ meter). In-memory
    // only — a reference for the curious, never persisted.
    H.setLastRequest({
      at: new Date().toLocaleTimeString(),
      model: opts.model || 'glm-5.3',
      opts: { temperature: opts.temperature, top_p: opts.topP, max_tokens: opts.maxTokens || '(provider default)', thinking: !!opts.thinking, effort: opts.reasoningEffort || 'max', context_window: opts.contextWindow || 0 },
      messages: reqMsgs,
    });
    H.setCurrentRequest(window.api.chatStream(reqMsgs, opts, {
      onRetry: (attempt) => H.setStatus('retrying… (attempt ' + attempt + ')', 'ok'),
      onThink: (delta) => {
        streamStarted = true;
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
        streamStarted = true;
        hideThinking(el);
        kickWatchdog();
        if (!body.classList.contains('caret')) body.classList.add('caret');
        bodyBuf += delta;
        if (H.statusText() !== 'writing…') H.setStatus('writing…', 'ok');
      },
      onDone: (full, finishReason) => {
        hideThinking(el);
        clearTimeout(watchdog);
        finishAnchor = (!H.atBottom()) ? H.captureScrollAnchor() : null;   // pin the reader's line BEFORE any finish mutations
        streaming = false;
        if (full) bodyBuf = full;
        bodyBuf = H.applyPhraseBans(bodyBuf);   // tidy banned phrases out of the final reply (model never sees the list)
        if (seed && thinkBuf) thinkBuf = seed + '\n' + thinkBuf;   // a prefill today steers tomorrow
        el.__raw = bodyBuf;   // the streamed reply's raw source was never set (placeholder was '') — copy/edit need it
        if (window.Constellation.mood) window.Constellation.mood.assess(bodyBuf || thinkBuf);   // the sky weathers the story
        const vLore = loreCtx && loreCtx.items.length ? loreCtx.items.map((it) => ({ label: it.label, text: String(it.text || '').slice(0, 300) })) : undefined;
        if (variantTarget) {
          // Keep the prior take(s); add this one and make it the active variant.
          const m = H.getConv()[variantCi];
          if (m) {
            if (!Array.isArray(m.variants)) m.variants = [{ content: m.content || '', reasoning: m.reasoning, lore: m.lore }];
            m.variants.push({ content: bodyBuf, reasoning: thinkBuf || undefined, lore: vLore });
            m.vActive = m.variants.length - 1;
            m.content = bodyBuf; m.reasoning = thinkBuf || undefined; m.lore = vLore;
          }
        } else {
          H.getConv().push({ role: 'assistant', content: bodyBuf, reasoning: thinkBuf || undefined, lore: vLore });
        }
        if (window.Constellation && window.Constellation.diag) window.Constellation.diag.note('reply-finish', 'len ' + String(bodyBuf || '').length);   // scroll-capture correlation
        if (H.hasFilterEffect(bodyBuf)) {
          const acts = el.querySelector('.msg-actions');
          if (acts && !acts.querySelector('[data-action="rawview"]')) { const fb = H.filterBtn(el); if (fb) acts.appendChild(fb); }
        }
        if (thinkDetails && thinkBuf && H.atBottom()) thinkDetails.open = false;   // fold thinking away once the answer is in — but NOT while the reader is scrolled up (the collapse would yank their view)
        if (finishReason === 'length') {   // hit the max-length cap -> offer to continue from the cutoff
          el.classList.add('continuable');
          const acts = el.querySelector('.msg-actions');
          if (acts && !acts.querySelector('[data-action="continue"]')) acts.appendChild(Constellation.sculpt.actionBtn('continue', '↪ Continue'));
        }
        H.setBusy(false);
        H.restoreSendBtn();
        H.setStatus('connected', 'ok');
        H.updateContextMeter();
        H.focusInput();
        H.addUsageTokens(Math.round(((full || bodyBuf).length + (thinkBuf || '').length) / 4));   // count the reply's tokens too
        H.persistTurn();   // persist the chat + instructions + settings + usage + files
        Constellation.sculpt.syncThinkEditedMark(el, thinkBuf || '');
        // Exact context size: ask GLM's tokenizer what this conversation actually costs. Estimate
        // (chars÷4) stays the display until this returns; non-GLM/no-key/failure keeps it forever.
        if (window.api && window.api.tokenizerCount) {
          window.api.tokenizerCount(reqMsgs).then((r) => {
            if (r && r.ok && typeof r.tokens === 'number') { H.setContextExact(r.tokens); H.updateContextMeter(); }
          }).catch(() => {});
        }
        if (variantTarget) Constellation.sculpt.renderVariantNav(el);
        if (finishAnchor) { H.restoreScrollAnchor(finishAnchor); requestAnimationFrame(() => H.restoreScrollAnchor(finishAnchor)); }
        if (!rafId) rafId = requestAnimationFrame(pump);   // flush any buffered tail at the flow rate
      },
      onError: (message) => {
        hideThinking(el);
        clearTimeout(watchdog);
        streaming = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        const friendly = H.friendlyError(message);
        if (window.Constellation && window.Constellation.toast) window.Constellation.toast(friendly, 9000);   // linger: errors are read in hindsight
        if (variantTarget) {
          Constellation.sculpt.renderActiveVariant(el);   // regen failed — restore the existing active take
        } else {
          el.remove();   // remove the placeholder entirely: an error bubble with no conversation
                         // entry desynced every index-based operation after it (edit/fork/bookmarks)
        }
        H.setBusy(false);
        H.restoreSendBtn();
        H.setStatus('error', 'err', friendly);   // hover the pill to re-read the error after the toast fades
        H.focusInput();
      },
    }));
  }

  return { init: init, streamReply: streamReply };
})();
