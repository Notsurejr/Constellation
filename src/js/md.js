// Markdown rendering: vendored marked + a light DOM sanitizer + the immersion grammar.
// Stateless — used by the chat renderer (and anything else that needs to turn model output
// into safe HTML).
//
// The immersion grammar (authored by the MODEL, rendered here — the user never types it):
//   line-level (pre-marked):  << earth/left italic · >> ship/right bold · @ slug ·
//                             ^ drop-cap paragraph · %% centered interlude block %%
//   inline (post-marked DOM): !!smash!! · ::s p a c e d:: · {{whisper}} · ~alien~ ·
//                             ||redacted|| · ==marked== · [[msg]] · [[>sent msg]]
//   fenced ```file blocks render as dossiers via CSS.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.md = (function () {
  let _markedReady = false;
  function ensureMarked() {
    if (_markedReady || !window.marked) return;
    try {
      if (typeof window.marked.use === 'function') window.marked.use({ gfm: true, breaks: true });
      else if (typeof window.marked.setOptions === 'function') window.marked.setOptions({ gfm: true, breaks: true });
    } catch (e) { console.warn('[constellation]', e && e.message || e); }
    _markedReady = true;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- line-level grammar, applied to the raw markdown before marked ----
  // Single tildes would be eaten by GFM strikethrough, so they become PUA sentinels first.
  const TILDE_IN = /(^|[^~])~([^~\n]+)~(?!~)/g;
  function preGrammar(src) {
    src = src.replace(TILDE_IN, function (all, pre, body) { return pre + '' + body + ''; });
    const lines = src.split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (t.startsWith('<< ') || t === '<<') {
        out.push('<p class="g-earth">' + escapeHtml(t.slice(2).trim()) + '</p>'); out.push('');
        i++; continue;
      }
      if (t.startsWith('>> ') || t === '>>') {
        out.push('<p class="g-ship">' + escapeHtml(t.slice(2).trim()) + '</p>'); out.push('');
        i++; continue;
      }
      if (t.startsWith('@ ') && t.length <= 90) {
        out.push('<p class="g-slug">' + escapeHtml(t.slice(2).trim()) + '</p>'); out.push('');
        i++; continue;
      }
      if (t === '%%') {   // centered interlude block, closed by the next %% line
        const buf = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '%%') { buf.push(escapeHtml(lines[i])); i++; }
        i++;   // consume the closer if present
        out.push('<div class="g-center">' + buf.join('<br>') + '</div>'); out.push('');
        continue;
      }
      if (t === '%%' + '%%') { out.push(''); i++; continue; }   // unreachable guard
      if (t.startsWith('%%') && t.endsWith('%%') && t.length > 4) {   // single-line interlude
        out.push('<div class="g-center">' + escapeHtml(t.slice(2, -2).trim()) + '</div>'); out.push('');
        i++; continue;
      }
      if (t.startsWith('^') && t.length > 1) {   // drop-cap paragraph: through the next blank line
        const buf = [escapeHtml(t.slice(1))];
        i++;
        while (i < lines.length && lines[i].trim() !== '') { buf.push(escapeHtml(lines[i])); i++; }
        out.push('<p class="g-dropcap">' + buf.join('<br>') + '</p>'); out.push('');
        continue;
      }
      out.push(line);
      i++;
    }
    return out.join('\n');
  }

  // ---- inline grammar, applied to the rendered DOM's text nodes (never inside code/pre) ----
  const INLINE_RE = /\[\[>([^\]\n]+)\]\]|\[\[([^\]\n]+)\]\|?\]?|!!([^!\n]+)!!|::([^:\n]+)::|\{\{([^}\n]+)\}\}|\|\|([^|\n]+)\|\||==([^=\n]+)==|~([^~\n]+)~|\uE000([^\uE001\n]+)\uE001/g;
  function inlineWrap(doc, text, cls) {
    const span = doc.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  }
  function postGrammar(root) {
    const doc = root.ownerDocument || document;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const p = n.parentElement;
      if (!p) continue;
      const tag = p.tagName.toLowerCase();
      if (tag === 'code' || tag === 'pre' || p.classList.contains('g-redact')) continue;   // don't nest, don't touch code
      if (INLINE_RE.test(n.textContent)) nodes.push(n);
      INLINE_RE.lastIndex = 0;
    }
    for (const n of nodes) {
      const text = n.textContent;
      const frag = doc.createDocumentFragment();
      let last = 0, m;
      INLINE_RE.lastIndex = 0;
      while ((m = INLINE_RE.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        if (m[1] != null) frag.appendChild(inlineWrap(doc, m[1], 'g-msg self'));
        else if (m[2] != null) frag.appendChild(inlineWrap(doc, m[2], 'g-msg'));
        else if (m[3] != null) frag.appendChild(inlineWrap(doc, m[3], 'g-smash'));
        else if (m[4] != null) frag.appendChild(inlineWrap(doc, m[4], 'g-spaced'));
        else if (m[5] != null) {
          // Macro-shaped tokens ({{turn}}, {{roll:…}}, {{random:…}}, {{time}}, {{date}}) are
          // syntax, not whispers — in regular chats they ride the wire verbatim and must keep
          // their braces on screen too. Only non-macro braces render as the whisper register.
          if (/^\{\{\s*(?:turn|roll|random|time|date)\b/i.test(m[0])) frag.appendChild(doc.createTextNode(m[0]));
          else frag.appendChild(inlineWrap(doc, m[5], 'g-whisper'));
        }
        else if (m[6] != null) frag.appendChild(inlineWrap(doc, m[6], 'g-redact'));
        else if (m[7] != null) frag.appendChild(inlineWrap(doc, m[7], 'g-mark'));
        else if (m[8] != null) frag.appendChild(inlineWrap(doc, m[8], 'g-alien'));
        else if (m[9] != null) frag.appendChild(inlineWrap(doc, m[9], 'g-alien'));   // PUA sentinel (tilde-smuggled past marked)
        last = m.index + m[0].length;
      }
      if (last === 0) continue;
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  }

  // ---- Dialogue voice: wrap spoken spans, natively (punctuation-only detection) ----
  // A text-walking pass over the rendered DOM: paired double quotes (straight " and curly
  // “ ” both, state machine resolves straight-quote ambiguity) become .dlg spans with the
  // marks in their own .q spans. Nothing the model has to do; nothing stored changes.
  // While STREAMING, an unclosed opening quote wraps to the end of its block so the voice
  // is live from the first spoken word, then settles into a proper pair when the closing
  // quote arrives.
  let dlgCfg = { style: 'off', cadence: false };
  function setDialogue(cfg) {
    if (!cfg) return;
    if (cfg.style !== undefined) dlgCfg.style = String(cfg.style);
    if (cfg.cadence !== undefined) dlgCfg.cadence = !!cfg.cadence;
  }
  const isQ = (ch) => ch === '"' || ch === '\u201C' || ch === '\u201D';

  function blockTextNodes(block) {
    const doc = block.ownerDocument || document;
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    const out = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      let p = n.parentElement, bad = false;
      while (p && p !== block) { const tg = p.tagName && p.tagName.toLowerCase(); if (tg === 'code' || tg === 'pre') { bad = true; break; } p = p.parentElement; }
      if (!bad && n.textContent) out.push(n);
    }
    return out;
  }

  function wrapSegment(doc, seg, block) {
    // One quote → spoken spans. Segments wrap in reverse document order so earlier
    // splitText calls never shift later indices. NOTHING EVER MOVES: every fragment is
    // wrapped at the position it already occupies (the previous move-into-one-span
    // approach reordered the sentence whenever a quote crossed an element boundary).
    const qAt = (node) => {   // a quote mark, wrapped in place
      const s = doc.createElement('span'); s.className = 'q';
      node.parentNode.replaceChild(s, node); s.appendChild(node);
      return s;
    };
    const dlgAt = (node) => {   // a spoken text chunk, wrapped in place
      const s = doc.createElement('span'); s.className = 'dlg';
      node.parentNode.replaceChild(s, node); s.appendChild(node);
      return s;
    };
    if (seg.node === seg.node2) {
      // Common case: both marks in one text node.  T = [prefix][open][content][close][tail]
      const span = doc.createElement('span'); span.className = 'dlg';
      const tail = seg.node.splitText(seg.mend);
      const closeM = seg.node.splitText(seg.end);
      const content = seg.node.splitText(seg.start);
      const openM = seg.node.splitText(seg.mstart);
      const q = (node) => { const s = doc.createElement('span'); s.className = 'q'; s.appendChild(node); return s; };
      span.appendChild(q(openM)); span.appendChild(content);
      if (closeM.length) span.appendChild(q(closeM));   // streaming-unclosed segs carry no close mark
      seg.node.parentNode.insertBefore(span, tail);
    } else {
      // The quote crosses an element boundary (e.g. "…**bold**…"). Each text chunk gets
      // its own .dlg span AT ITS POSITION, the marks get .q wraps in place, and whole
      // inline elements between the marks are TAGGED .dlg so formatted speech keeps the
      // voice. Multiple .dlg fragments render as one voice under every treatment.
      // 1. tag strictly-between inline elements first, while the original nodes are whole
      try {
        for (const elm of block.querySelectorAll('em, strong, b, i, a, del, span')) {
          if (elm.classList.contains('dlg')) continue;
          const rA = seg.node.compareDocumentPosition(elm);
          const rB = seg.node2.compareDocumentPosition(elm);
          if ((rA & Node.DOCUMENT_POSITION_FOLLOWING) && (rB & Node.DOCUMENT_POSITION_PRECEDING)) elm.classList.add('dlg');
        }
      } catch (e) { /* compare hiccups must never break rendering */ }
      // 2. isolate the marks: A = [prefix][markA][contentA…] · B = [head…][closeM][tail]
      const markA = seg.node.splitText(seg.mstart);
      const contentA = markA.splitText(1);
      seg.node2.splitText(seg.mend);   // drop the tail from the close side's working node
      const closeM = seg.node2.splitText(seg.end);
      // 3. wrap in place: marks → .q, spoken chunks → .dlg, plus any bare text nodes
      //    sitting directly between the marks (not already inside a tagged element)
      qAt(markA);
      if (closeM.length) qAt(closeM);   // streaming-unclosed segs carry no close mark
      if (contentA.length) dlgAt(contentA);
      if (seg.node2.length) dlgAt(seg.node2);
      try {
        for (const n of blockTextNodes(block)) {
          if (!n.textContent) continue;
          let p = n.parentElement, covered = false;
          while (p && p !== block) { if (p.classList.contains('dlg')) { covered = true; break; } p = p.parentElement; }
          if (covered) continue;
          const rA = markA.compareDocumentPosition(n);
          const rB = closeM.compareDocumentPosition(n);
          if ((rA & Node.DOCUMENT_POSITION_FOLLOWING) && (rB & Node.DOCUMENT_POSITION_PRECEDING)) dlgAt(n);
        }
      } catch (e) { /* never break rendering for a quote */ }
    }
  }

  function dialoguePass(root, streaming) {
    const doc = root.ownerDocument || document;
    const blocks = root.querySelectorAll('p, li');
    for (const block of blocks) {
      const texts = blockTextNodes(block);
      if (!texts.length) continue;
      // Phase 1 — find quote segments across the block's text nodes (state machine).
      const segs = [];   // { node, mstart, start, node2, end, mend } (mark positions inclusive)
      let open = null;
      for (const n of texts) {
        const t = n.textContent;
        let i = 0;
        while (i < t.length) {
          if (!open) {
            while (i < t.length && !isQ(t[i])) i++;
            if (i >= t.length) break;
            open = { node: n, idx: i };
            i++;
          } else {
            while (i < t.length && !isQ(t[i])) i++;
            if (i >= t.length) continue;   // still open into the next node
            segs.push({ node: open.node, mstart: open.idx, start: open.idx + 1, node2: n, end: i, mend: i + 1 });
            open = null;
            i++;
          }
        }
      }
      if (open && streaming) {
        const last = texts[texts.length - 1];
        segs.push({ node: open.node, mstart: open.idx, start: open.idx + 1, node2: last, end: last.textContent.length, mend: last.textContent.length });
      }
      if (!segs.length) continue;
      // A block whose first non-space character opens a quote is "dialogue-led" (Editorial's margin bar).
      if (segs[0].node === texts[0] && !texts[0].textContent.slice(0, segs[0].mstart).trim()) block.classList.add('has-lead-dlg');
      // Phase 2 — wrap (reverse order keeps indices stable).
      for (let s = segs.length - 1; s >= 0; s--) {
        try { wrapSegment(doc, segs[s], block); } catch (e) { /* never break rendering for a quote */ }
      }
    }
  }

  // Cadence: em/en-dashes and ellipses get breathing room and a faint tint.
  const CADENCE_RE = /(\u2014|\u2013|\u2026|\.{3})/g;
  function cadencePass(root) {
    const doc = root.ownerDocument || document;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const p = n.parentElement;
      if (!p) continue;
      const tag = p.tagName.toLowerCase();
      if (tag === 'code' || tag === 'pre') continue;
      if (CADENCE_RE.test(n.textContent)) nodes.push(n);
      CADENCE_RE.lastIndex = 0;
    }
    for (const n of nodes) {
      const text = n.textContent;
      const frag = doc.createDocumentFragment();
      let last = 0, m;
      CADENCE_RE.lastIndex = 0;
      while ((m = CADENCE_RE.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        const s = doc.createElement('span');
        s.className = 'cadence';
        s.textContent = m[0];
        frag.appendChild(s);
        last = m.index + m[0].length;
      }
      if (last === 0) continue;
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  }

  // Strip scripts, event handlers, and javascript:/data:html URLs from a parsed fragment.
  function sanitizeFragment(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const kill = [];
    let node = walker.nextNode();
    while (node) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' ||
          tag === 'embed' || tag === 'link' || tag === 'meta' || tag === 'form') {
        kill.push(node);
      } else {
        for (const a of Array.from(node.attributes)) {
          const nm = a.name.toLowerCase();
          if (nm.startsWith('on')) node.removeAttribute(a.name);
          else if ((nm === 'href' || nm === 'src' || nm === 'xlink:href') &&
                   /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) node.removeAttribute(a.name);
        }
      }
      node = walker.nextNode();
    }
    for (const k of kill) k.remove();
  }
  function render(text, opts) {
    const src = String(text == null ? '' : text);
    if (!window.marked) return escapeHtml(src).replace(/\n/g, '<br>');
    ensureMarked();
    let html;
    try { html = window.marked.parse(preGrammar(src), { gfm: true, breaks: true }); }
    catch (e) { return escapeHtml(src).replace(/\n/g, '<br>'); }
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    try { postGrammar(tpl.content); } catch (e) { console.warn('[constellation]', e && e.message || e); }
    // Dialogue voice + cadence marks — skipped entirely when both are off (the default),
    // so normal chats render exactly as they always did.
    if (dlgCfg.style !== 'off' || dlgCfg.cadence) {
      try {
        if (dlgCfg.style !== 'off') dialoguePass(tpl.content, !!(opts && opts.streaming));
        if (dlgCfg.cadence) cadencePass(tpl.content);
      } catch (e) { console.warn('[constellation]', e && e.message || e); }
    }
    sanitizeFragment(tpl.content);
    return tpl.innerHTML;
  }
  return { render, escape: escapeHtml, setDialogue };
})();
