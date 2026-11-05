// Sculpt: the per-message editing surface — edit-and-resend (user messages), sculpt in
// place + reasoning steering (assistant messages), regenerate variants, fork, copy, and
// the attachment eye/× controls. Everything here is reached from a message's action
// buttons (onMessageClick is wired by chat.js).
//
// STATE STAYS IN CHAT: this module receives everything through an explicit hooks object
// at init (conversation getter, busy getter, the render/lifecycle functions). The
// conversation array is only ever mutated IN PLACE from here — never reassigned — so the
// getter always sees the truth even after the chat switches underneath us. Extracted
// from chat.js in the module split (step 2); compose (step 1) is reached globally.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.sculpt = (function () {
  let H = null;   // hooks — set once by chat.init
  const messagesEl = () => document.getElementById('messages');

  function init(hooks) { H = hooks; }

  // A small text button carrying data-action (delegated handling via onMessageClick).
  function actionBtn(action, text) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'msg-action';
    b.dataset.action = action;
    b.textContent = text;
    return b;
  }

  function onMessageClick(e) {
    const btn = e.target.closest('.msg-action');
    if (!btn) return;
    const el = e.target.closest('.msg');
    if (!el || H.busy()) return;
    if (messagesEl().querySelector('.msg[data-editing="1"]')) return;   // an edit is already open
    const action = btn.dataset.action;
    if (action === 'edit') startEdit(el);
    else if (action === 'sculpt') startSculpt(el);
    else if (action === 'regen') regenerate(el);
    else if (action === 'fork') forkFromEl(el);
    else if (action === 'copy') copyMessage(el);
    else if (action === 'bookmark') H.toggleBookmark(el);
    else if (action === 'continue') H.continueReply(el);
  }

  // Branch a NEW chat off the clicked message: snapshot the conversation up to and including it
  // (the current chat is untouched) and hand it to sessions to create the fork.
  function forkFromEl(el) {
    const msgs = Array.from(messagesEl().querySelectorAll('.msg'));
    const idx = msgs.indexOf(el);
    if (idx === -1) return;
    // conversation[0] is the system message (no DOM element), so DOM idx -> conversation[idx+1].
    const prefix = H.conv().slice(1, idx + 2)
      .map((m) => ({ role: m.role, content: m.content, files: m.files, reasoning: m.reasoning, edited: !!m.edited, orig: m.orig, rOrig: m.rOrig, variants: m.variants, vActive: m.vActive, lore: m.lore }));
    if (window.Constellation && window.Constellation.sessions && window.Constellation.sessions.forkFrom) {
      window.Constellation.sessions.forkFrom(Object.assign({ messages: prefix }, H.forkBundle()));
    }
  }

  function truncateFromEl(el) {
    const msgs = Array.from(messagesEl().querySelectorAll('.msg'));
    const idx = msgs.indexOf(el);
    if (idx === -1) return;
    for (let i = msgs.length - 1; i >= idx; i--) msgs[i].remove();
    H.conv().length = idx + 1;
  }
  // conversation[0] is the system message (no DOM node), so a .msg at DOM index i is conversation[i+1].
  function convIndexForEl(el) {
    const msgs = Array.from(messagesEl().querySelectorAll('.msg'));
    return msgs.indexOf(el) + 1;
  }
  // Remove messages strictly AFTER el (keep el) — used when re-rolling a reply, so anything that
  // followed it (responses to the old take) is dropped while the message itself stays for variants.
  function truncateAfterEl(el) {
    const msgs = Array.from(messagesEl().querySelectorAll('.msg'));
    const idx = msgs.indexOf(el);
    if (idx === -1) return;
    for (let i = msgs.length - 1; i > idx; i--) msgs[i].remove();
    H.conv().length = idx + 2;   // keep through conversation[idx+1] (= msgs[idx] = el)
  }

  // A thin-stroke SVG eye (slash when hidden) — the context-visibility toggle for attachments.
  function eyeSvg(off) {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.classList.add('eye-ico');
    const almond = document.createElementNS(NS, 'path');
    almond.setAttribute('d', 'M2.5 12 C5.5 6.9 9 5 12 5 S18.5 6.9 21.5 12 C18.5 17.1 15 19 12 19 S5.5 17.1 2.5 12 Z');
    almond.setAttribute('fill', 'none'); almond.setAttribute('stroke', 'currentColor'); almond.setAttribute('stroke-width', '1.5');
    const iris = document.createElementNS(NS, 'circle');
    iris.setAttribute('cx', '12'); iris.setAttribute('cy', '12'); iris.setAttribute('r', '3.1');
    iris.setAttribute('fill', 'none'); iris.setAttribute('stroke', 'currentColor'); iris.setAttribute('stroke-width', '1.5');
    s.appendChild(almond); s.appendChild(iris);
    if (off) {
      const slash = document.createElementNS(NS, 'line');
      slash.setAttribute('x1', '4.5'); slash.setAttribute('y1', '19.5'); slash.setAttribute('x2', '19.5'); slash.setAttribute('y2', '4.5');
      slash.setAttribute('stroke', 'currentColor'); slash.setAttribute('stroke-width', '1.5');
      s.appendChild(slash);
    }
    return s;
  }

  // Re-render a sent message's passive attachment chips (after eye/X changes in edit mode).
  function refreshMsgFileChips(el) {
    const fc = el.querySelector('.msg-files');
    if (!fc) return;
    fc.replaceChildren();
    for (const f of (el.__files || [])) fc.appendChild(H.fileChipEl(f, false));
  }

  // Attachment controls while editing a user prompt: the eye and × overlay the chips themselves
  // (no separate list). Eye = hide from context (stays in chat, stops being sent); × = delete
  // from the chat entirely. Both take effect immediately.
  function applyAttachEditControls(el) {
    const files = el.__files || [];
    const fc = el.querySelector('.msg-files');
    if (!fc || !files.length) return;
    const chips = Array.from(fc.children).filter((c) => c.classList && c.classList.contains('attach-chip'));
    chips.forEach((chip, i) => {
      const f = files[i];
      if (!f) return;
      chip.classList.add('editing');
      chip.querySelectorAll('.attach-eye, .attach-x').forEach((b) => b.remove());
      const eye = document.createElement('button');
      eye.type = 'button'; eye.className = 'attach-eye';
      eye.title = f.excluded ? 'Hidden from context — click to send with future calls' : 'Sent with every call — click to hide from context (stays in chat)';
      eye.appendChild(eyeSvg(!!f.excluded));
      eye.addEventListener('click', () => {
        f.excluded = !f.excluded; H.persist();
        chip.classList.toggle('excluded', !!f.excluded);
        applyAttachEditControls(el);   // refresh the eye state
        H.meter();
      });
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'attach-x'; x.title = 'Delete from this chat'; x.textContent = '×';
      x.addEventListener('click', () => {
        const idx = files.indexOf(f);
        if (idx !== -1) files.splice(idx, 1);
        H.persist();
        if (!files.length) { fc.remove(); }
        else { refreshMsgFileChips(el); applyAttachEditControls(el); }
        H.meter();
      });
      chip.appendChild(eye);
      chip.appendChild(x);
    });
  }

  // Edit ended (cancel path — save path rebuilds the message): drop the overlay controls.
  function clearAttachEditControls(el) {
    const fc = el.querySelector('.msg-files');
    if (!fc) return;
    fc.querySelectorAll('.attach-chip.editing').forEach((chip) => {
      chip.classList.remove('editing');
      chip.querySelectorAll('.attach-eye, .attach-x').forEach((b) => b.remove());
    });
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
    applyAttachEditControls(el);   // eye/X overlay the attachment chips — edit mode only

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
      const typed = ta.value.trim();
      const cp = window.Constellation.compose;
      const v = cp.MACRO_HINT.test(typed) ? cp.applySendMacros(typed, H.conv().filter((m) => m.role === 'user').length) : typed;   // resend = a fresh send: new macros freeze anew
      const files = el.__files || [];   // keep the message's existing attachments on resend
      el.dataset.editing = '';
      if (!v && !files.length) { restoreMessage(el, original); return; }
      truncateFromEl(el);
      H.addMessage('user', v, files);
      H.conv().push({ role: 'user', content: v, files: files.length ? files : undefined });
      H.streamReply();
    });
    cancel.addEventListener('click', () => restoreMessage(el, original));
  }

  function restoreMessage(el, original) {
    el.dataset.editing = '';
    el.classList.remove('editing');
    clearAttachEditControls(el);   // chips return to display-only (excluded state stays)
    const body = el.querySelector('.body');
    if (body) { body.classList.add('md'); body.innerHTML = H.renderBodyHTML(original); H.enhanceCodeBlocks(body); }
    const bar = el.querySelector('.edit-bar');
    if (bar) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.appendChild(actionBtn('edit', '✎ Edit'));
      actions.appendChild(actionBtn('fork', '⑂ Fork'));
      actions.appendChild(actionBtn('copy', '⎘ Copy'));
      actions.appendChild(actionBtn('bookmark', '☆'));
      bar.replaceWith(actions);
      H.applyBookmarkGlyph(el);
    }
  }

  // ---- sculpt: edit the model's prose in place. No resend, nothing after it changes — the
  // conversation (and the model's future context) simply carries your wording from here on.
  // The model's original is kept on the message (m.orig) so the edit can be studied, and so an
  // optional "teach from edits" mode can show the model how you bend its voice.
  // ---- reasoning editor (steering) ----
  // The model treats history's reasoning_content as its own prior thinking. Editing it in place
  // changes what it "remembers having thought" — a durable steer on every future reply. The
  // original is kept (m.rOrig) for fidelity and restore, exactly like sculpt keeps m.orig.
  function syncThinkEditedMark(el, current) {
    const m = H.conv()[convIndexForEl(el)];
    const lbl = el.querySelector('.think-lbl');
    if (!lbl) return;
    const edited = !!(m && m.rOrig && m.rOrig !== current);
    lbl.textContent = edited ? '✦ Thinking ·✎' : '✦ Thinking';
  }

  function startThinkEdit(el, thinkDetails) {
    const m = H.conv()[convIndexForEl(el)];
    const thinkBody = thinkDetails.querySelector('.think-body');
    if (!m || !m.reasoning || !thinkBody || thinkDetails.dataset.editing === '1') return;
    thinkDetails.dataset.editing = '1';
    const original = m.reasoning;
    const ta = document.createElement('textarea');
    ta.className = 'think-edit';
    ta.value = original;
    thinkBody.replaceChildren(ta);
    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    const save = actionBtn('commit', 'Save reasoning');
    const cancel = actionBtn('cancel', 'Cancel');
    bar.appendChild(save); bar.appendChild(cancel);
    thinkBody.appendChild(bar);
    ta.focus();
    const finish = () => { thinkDetails.dataset.editing = ''; };
    save.addEventListener('click', () => {
      m.rOrig = m.rOrig || original;   // first edit keeps the model's own words
      m.reasoning = ta.value;
      H.persist();
      thinkBody.replaceChildren();
      thinkBody.textContent = ta.value;
      syncThinkEditedMark(el, ta.value);
      H.meter();
      finish();
      if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Reasoning steered — the model remembers this version');
    });
    cancel.addEventListener('click', () => {
      thinkBody.replaceChildren();
      thinkBody.textContent = original;
      finish();
    });
  }

  function startSculpt(el) {    const body = el.querySelector('.body');
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
      const m = H.conv()[convIndexForEl(el)];
      if (!m) { restoreSculpt(el, original); return; }
      if (v && v !== original) {
        if (!m.orig) m.orig = original;   // first take stays on record; re-sculpts just move the target
        m.content = v;
        m.edited = true;
        if (Array.isArray(m.variants) && m.variants[m.vActive || 0]) m.variants[m.vActive || 0].content = v;
      }
      H.persist();
      renderSculpted(el, v || original, !!(m && m.edited));
    });
    cancel.addEventListener('click', () => restoreSculpt(el, original));
  }
  function restoreSculpt(el, original) {
    el.dataset.editing = '';
    el.classList.remove('editing');
    const m = H.conv()[convIndexForEl(el)];
    renderSculpted(el, original, !!(m && m.edited));
  }
  function renderSculpted(el, content, edited) {
    el.dataset.editing = '';   // the save path lands here too — without this the "an edit is
                               // already open" guard silently blocked every later message
                               // action until a re-render (pre-existing bug, surfaced by the
                               // split's probe sequence)
    el.__raw = content;
    const body = el.querySelector('.body');
    if (body) {
      body.classList.add('md');
      body.innerHTML = H.renderBodyHTML(content);
      H.enhanceCodeBlocks(body);
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
      H.applyBookmarkGlyph(el);
    }
    const metaEl = el.querySelector('.msg-meta');
    if (metaEl) H.updateMeta(metaEl, body ? body.textContent : '', edited);
  }

  function regenerate(el) {
    if (H.busy()) return;
    truncateAfterEl(el);   // keep this reply, drop anything after it; we're adding another take
    H.streamReply(el);
  }

  // ---- regenerate variants: keep multiple takes of a reply, flip between them ----
  // Re-render a message's active variant (content + thinking + meta + lore log + nav).
  function renderActiveVariant(el) {
    const m = H.conv()[convIndexForEl(el)];
    if (!m) return;
    el.__raw = m.content || '';   // keep copy/edit on the active variant's raw source
    const body = el.querySelector('.body');
    if (body) { body.classList.remove('caret'); body.style.color = ''; body.innerHTML = H.renderBodyHTML(m.content || ''); H.enhanceCodeBlocks(body); }
    const think = el.querySelector('.think-block');
    if (think) {
      if (m.reasoning) { think.hidden = false; think.open = false; const tb = think.querySelector('.think-body'); if (tb) tb.textContent = m.reasoning; }
      else think.hidden = true;
    }
    const metaEl = el.querySelector('.msg-meta'); if (metaEl) H.updateMeta(metaEl, body ? body.textContent : '', !!m.edited);
    const oldLore = el.querySelector('.lore-used'); if (oldLore) oldLore.remove();
    if (m.lore && m.lore.length) H.addLoreIndicator(el, m.lore);
    renderVariantNav(el);
  }
  // Add/refresh the ‹ n/total › control (only shown when there's more than one take).
  function renderVariantNav(el) {
    const m = H.conv()[convIndexForEl(el)];
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
    if (H.busy()) return;
    const m = H.conv()[convIndexForEl(el)];
    if (!m || !Array.isArray(m.variants) || m.variants.length < 2) return;
    let n = (m.vActive || 0) + dir;
    if (n < 0) n = m.variants.length - 1;
    if (n >= m.variants.length) n = 0;
    m.vActive = n;
    const v = m.variants[n] || {};
    m.content = v.content || ''; m.reasoning = v.reasoning; m.lore = v.lore;   // mirror active → what gets sent/continued
    renderActiveVariant(el);
    H.persist();
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

  return {
    init: init,
    actionBtn: actionBtn,
    onMessageClick: onMessageClick,
    convIndexForEl: convIndexForEl,
    startThinkEdit: startThinkEdit,
    syncThinkEditedMark: syncThinkEditedMark,
    renderActiveVariant: renderActiveVariant,
    renderVariantNav: renderVariantNav,
  };
})();
