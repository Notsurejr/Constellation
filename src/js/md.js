// Markdown rendering: vendored marked + a light DOM sanitizer + the immersion grammar.
// Stateless — used by the chat renderer (and anything else that needs to turn model output
// into safe HTML).
//
// The immersion grammar (authored by the MODEL, rendered here — the user never types it):
//   line-level (pre-marked):  << earth/left italic · >> ship/right bold · @ slug (Place · Time) ·
//                             ^ drop-cap paragraph · %% centered interlude block %%
//                             !! impact line · ... silent-beat line
//   inline (post-marked DOM): !!smash!! · ::s p a c e d:: · {{whisper}} · ~alien~ ·
//                             ||redacted|| · ==marked== · [[msg]] · [[!alert]] · [[>sent msg]] ·
//                             ++boom++ · ^^lifted^^ · [micro-beat]
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
  // Single tildes would be eaten by GFM strikethrough, so they become PUA sentinels first
  // (real Unicode private-use characters — the postGrammar regex matches the same escapes).
  const TILDE_IN = /(^|[^~])~([^~\n]+)~(?!~)/g;
  // `** "…" **` — spaced emphasis flanks around a quoted span are invisible to CommonMark's
  // flanking rules (marked leaves the asterisks literal, and models do this constantly).
  // Tighten ONLY the spaces between the emphasis run and the quote marks: quote-anchored,
  // line-scoped, so genuine asterisk prose is never touched.
  const SPACED_FLANK = /(\*{1,3})[ \t]+(["\u201C\u201D][^*_\n]*["\u201C\u201D])[ \t]+(\*{1,3})/g;
  function preGrammar(src) {
    src = src.replace(TILDE_IN, function (all, pre, body) { return pre + '\uE000' + body + '\uE001'; });
    const lines = src.split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (t === '...' || t === '\u2026' || t === '. . .') {
        // The silent beat — a standalone ellipsis is deliberate dead air, not a sentence.
        out.push('<p class="g-silence" aria-hidden="true">\u2026</p>'); out.push('');
        i++; continue;
      }
      if (t.startsWith('!! ') || t === '!!') {
        // Impact line — a full-width kinetic beat for abrupt cuts. (Inline !!panic!! has no
        // space after the marks, so the two never collide.)
        out.push('<p class="g-impact">' + escapeHtml(t.slice(3).trim()) + '</p>'); out.push('');
        i++; continue;
      }
      if (t.startsWith('<< ') || t === '<<') {
        out.push('<p class="g-earth">' + escapeHtml(t.slice(2).trim()) + '</p>'); out.push('');
        i++; continue;
      }
      if (t.startsWith('>> ') || t === '>>') {
        out.push('<p class="g-ship">' + escapeHtml(t.slice(2).trim()) + '</p>'); out.push('');
        i++; continue;
      }
      if (t.startsWith('@ ') && t.length <= 90) {
        // Cinematic slate — `Place · Time` splits into a two-part header when the model
        // uses the separator; anything else stays a single slate.
        const body = t.slice(2).trim();
        const at = body.indexOf(' \u00B7 ');
        if (at > 0 && at + 3 < body.length) {
          out.push('<p class="g-slug"><span class="g-slug-a">' + escapeHtml(body.slice(0, at)) + '</span><span class="g-slug-b">' + escapeHtml(body.slice(at + 3)) + '</span></p>');
        } else {
          out.push('<p class="g-slug">' + escapeHtml(body) + '</p>');
        }
        out.push('');
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
      if (t.startsWith('^') && t.length > 1 && t[1] !== '^') {
        // drop-cap paragraph: through the next blank line. (`^^lifted^^` inline marks are
        // explicitly excluded — they start with a doubled caret, never a drop-cap.)
        const buf = [escapeHtml(t.slice(1))];
        i++;
        while (i < lines.length && lines[i].trim() !== '') { buf.push(escapeHtml(lines[i])); i++; }
        out.push('<p class="g-dropcap">' + buf.join('<br>') + '</p>'); out.push('');
        continue;
      }
      out.push(line.replace(SPACED_FLANK, '$1$2$3'));
      i++;
    }
    return out.join('\n');
  }

  // ---- inline grammar, applied to the rendered DOM's text nodes (never inside code/pre) ----
  // Order matters: [[!alert]] and [[...]] must match before the single-bracket micro-beat,
  // so message fences win over stage cues.
  const INLINE_RE = /\[\[!([^\]\n]+)\]\]|\[\[>([^\]\n]+)\]\]|\[\[([^\]\n]+)\]\|?\]?|!!([^!\n]+)!!|::([^:\n]+)::|\{\{([^}\n]+)\}\}|\|\|([^|\n]+)\|\||==([^=\n]+)==|~([^~\n]+)~|\uE000([^\uE001\n]+)\uE001|\+\+([^+\n]+)\+\+|\^\^([^\^\n]+)\^\^|\[(?!\[|\d|\/)([^\[\]\n]{1,60})\]/g;
  const MACRO_SHAPE = /^\{\{\s*(?:turn|roll|random|time|date)\b/i;
  // A single-bracket span is a micro-beat only if it isn't a redaction/annotation token —
  // those belong to the pane convention even when a model drops them in prose.
  const REDACT_SHAPE = /^\s*(REDACTED|EXPUNGED|CLASSIFIED|WITHHELD|DATA EXPUNGED|illegible|unintelligible|smudged|torn|damaged|burned|scorched|blotted|redacted)\s*$/i;
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
      let p = n.parentElement, bad = false;
      while (p) {
        const tg = p.tagName && p.tagName.toLowerCase();
        if (tg === 'code' || tg === 'pre' || tg === 'a' || (p.classList && (p.classList.contains('g-redact') || p.classList.contains('g-beat') || p.classList.contains('g-msg')))) { bad = true; break; }
        p = p.parentElement;
      }
      if (bad) continue;
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
        if (m[1] != null) { const s = inlineWrap(doc, m[1], 'g-msg urgent'); frag.appendChild(s); }
        else if (m[2] != null) frag.appendChild(inlineWrap(doc, m[2], 'g-msg self'));
        else if (m[3] != null) frag.appendChild(inlineWrap(doc, m[3], 'g-msg'));
        else if (m[4] != null) frag.appendChild(inlineWrap(doc, m[4], 'g-smash'));
        else if (m[5] != null) frag.appendChild(inlineWrap(doc, m[5], 'g-spaced'));
        else if (m[6] != null) {
          // Macro-shaped tokens ({{turn}}, {{roll:…}}, {{random:…}}, {{time}}, {{date}}) are
          // syntax, not whispers — in regular chats they ride the wire verbatim and must keep
          // their braces on screen too. Only non-macro braces render as the whisper register.
          if (MACRO_SHAPE.test(m[0])) frag.appendChild(doc.createTextNode(m[0]));
          else frag.appendChild(inlineWrap(doc, m[6], 'g-whisper'));
        }
        else if (m[7] != null) frag.appendChild(inlineWrap(doc, m[7], 'g-redact'));
        else if (m[8] != null) frag.appendChild(inlineWrap(doc, m[8], 'g-mark'));
        else if (m[9] != null) frag.appendChild(inlineWrap(doc, m[9], 'g-alien'));
        else if (m[10] != null) frag.appendChild(inlineWrap(doc, m[10], 'g-alien'));   // PUA sentinel (tilde-smuggled past marked)
        else if (m[11] != null) frag.appendChild(inlineWrap(doc, m[11], 'g-boom'));
        else if (m[12] != null) frag.appendChild(inlineWrap(doc, m[12], 'g-lift'));
        else if (m[13] != null) {
          // Single-bracket span → a kinetic micro-beat, UNLESS it's a redaction/annotation
          // token (those keep their pane meaning) — matched last so [[...]] wins first.
          const inner = m[0].slice(1, -1);
          if (REDACT_SHAPE.test(inner)) frag.appendChild(doc.createTextNode(m[0]));
          else frag.appendChild(inlineWrap(doc, inner, 'g-beat'));
        }
        last = m.index + m[0].length;
      }
      if (last === 0) continue;
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  }

  // ---- Dialogue voice: wrap spoken spans, natively (punctuation-only detection) ----
  // A text-walking pass over the rendered DOM: paired double quotes (straight " and curly
  // “ ” both) become .dlg spans with the marks in their own .q spans. Curly marks carry
  // direction (“ opens, ” closes); straight quotes are ambiguous and get one guard — a
  // straight quote right after a digit with nothing spoken after it (5'10") is a measurement
  // closer, never an opener. While STREAMING, an unclosed opening quote wraps to the end of
  // its block so the voice is live from the first spoken word.
  let dlgCfg = { style: 'off', cadence: false, speakers: false };
  function setDialogue(cfg) {
    if (!cfg) return;
    if (cfg.style !== undefined) dlgCfg.style = String(cfg.style);
    if (cfg.cadence !== undefined) dlgCfg.cadence = !!cfg.cadence;
    if (cfg.speakers !== undefined) dlgCfg.speakers = !!cfg.speakers;
  }
  const isQ = (ch) => ch === '"' || ch === '\u201C' || ch === '\u201D';
  const speakerHue = (name) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 360;
  };

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
    // wrapped at the position it already occupies. Quote marks are wrapped INSIDE their own
    // .dlg (matching the single-node branch) so every theme's `.dlg .q` selector reaches
    // them — bare .q marks at paragraph level lose all voice styling.
    const qAt = (node) => {
      const w = doc.createElement('span'); w.className = 'dlg';
      const s = doc.createElement('span'); s.className = 'q';
      if (seg.speaker && dlgCfg.speakers) s.style.color = 'hsl(' + speakerHue(seg.speaker) + ' 42% 74%)';
      node.parentNode.replaceChild(w, node); w.appendChild(s); s.appendChild(node);
      return w;
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
      const q = (node) => {
        const s = doc.createElement('span'); s.className = 'q';
        if (seg.speaker && dlgCfg.speakers) s.style.color = 'hsl(' + speakerHue(seg.speaker) + ' 42% 74%)';
        s.appendChild(node); return s;
      };
      span.appendChild(q(openM)); span.appendChild(content);
      if (closeM.length) span.appendChild(q(closeM));   // streaming-unclosed segs carry no close mark
      seg.node.parentNode.insertBefore(span, tail);
    } else {
      // The quote crosses an element boundary (e.g. "…**bold**…"). Each text chunk gets
      // its own .dlg span AT ITS POSITION, the marks get .dlg>.q wraps in place, and whole
      // inline elements between the marks are TAGGED .dlg so formatted speech keeps the
      // voice. Multiple .dlg fragments render as one voice under every treatment.
      // 1. tag strictly-between inline elements first, while the original nodes are whole
      try {
        for (const elm of block.querySelectorAll('em, strong, b, i, a, del, span')) {
          if (elm.classList.contains('dlg') || elm.classList.contains('g-beat') || elm.classList.contains('g-redact')) continue;
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
      // 3. wrap in place: marks → .dlg>.q, spoken chunks → .dlg, plus any bare text nodes
      //    sitting directly between the marks (not already inside a tagged element)
      qAt(markA);
      if (closeM.length) qAt(closeM);   // streaming-unclosed segs carry no close mark
      if (contentA.length) dlgAt(contentA);
      if (seg.node2.length) dlgAt(seg.node2);
      try {
        for (const n of blockTextNodes(block)) {
          if (!n.textContent) continue;
          let p = n.parentElement, covered = false;
          while (p && p !== block) { if (p.classList.contains('dlg') || p.classList.contains('g-beat') || p.classList.contains('g-redact')) { covered = true; break; } p = p.parentElement; }
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
    const blocks = Array.from(root.querySelectorAll('p, li'));
    const shape = [];   // per-block dialogue shape, for the collision choreography below
    for (const block of blocks) {
      const texts = blockTextNodes(block);
      if (!texts.length) { shape.push({ el: block, has: false }); continue; }
      // Phase 1 — find quote segments across the block's text nodes (state machine).
      const segs = [];   // { node, mstart, start, node2, end, mend, speaker, endsDash, short }
      let open = null;
      let prevTail = '';      // last chars seen across nodes — measurement-artifact + cutoff lookbehind
      let openRem = 0;        // approximate quoted length of the open segment
      for (const n of texts) {
        const t = n.textContent;
        let i = 0;
        while (i < t.length) {
          if (!open) {
            let opened = false;
            while (i < t.length) {
              const ch = t[i];
              if (ch === '\u201C') { opened = true; break; }              // curly opener
              if (ch === '"') {
                const prev = i > 0 ? t[i - 1] : prevTail.slice(-1);
                const next = t[i + 1];
                // measurement artifact: digit + straight quote + boundary (5'10") — a closer
                // with no partner; never an opener
                if (/\d/.test(prev || '') && (!next || /[\s.,!?;:)\]}]/.test(next))) { i++; continue; }
                opened = true; break;
              }
              i++;
            }
            if (!opened) { prevTail = (prevTail + t).slice(-4); break; }
            open = { node: n, idx: i };
            openRem = t.length - i;
            i++;
          } else {
            while (i < t.length && !isQ(t[i])) i++;
            if (i >= t.length) { openRem += t.length; prevTail = (prevTail + t).slice(-4); continue; }   // still open into the next node
            const pre = (prevTail + t.slice(0, i)).slice(-4);
            segs.push({
              node: open.node, mstart: open.idx, start: open.idx + 1, node2: n, end: i, mend: i + 1,
              endsDash: /\u2014\s*$|\u2013\s*$/.test(pre) || /--\s*$/.test(pre),
              short: openRem + i <= 90,
            });
            open = null;
            i++;
          }
        }
      }
      // Speaker attribution: `Name: "…"` — the text before the opener is a short name line.
      // Same name→hue hash the comms transcript uses; zero new syntax from the model.
      if (segs.length && dlgCfg.speakers) {
        const s0 = segs[0];
        const idx0 = texts.indexOf(s0.node);
        const prefix = texts.slice(0, idx0 + 1).map((x, xi) => (xi === idx0 ? x.textContent.slice(0, s0.mstart) : x.textContent)).join('');
        const nm = prefix.match(/^([A-Za-z][A-Za-z0-9_' \u2019-]{0,23}):\s*$/);
        if (nm) { const speaker = nm[1].trim(); for (const s of segs) s.speaker = speaker; }
      }
      // Streaming: an open quote wraps to the end of its block so the voice is live from
      // the first spoken word, then settles when the closing quote arrives.
      if (open && streaming) {
        const last = texts[texts.length - 1];
        segs.push({ node: open.node, mstart: open.idx, start: open.idx + 1, node2: last, end: last.textContent.length, mend: last.textContent.length, endsDash: false, short: false });
      }
      if (!segs.length) { shape.push({ el: block, has: false }); continue; }
      // A block whose first non-space character opens a quote is "dialogue-led" (Editorial's margin bar).
      if (segs[0].node === texts[0] && !texts[0].textContent.slice(0, segs[0].mstart).trim()) block.classList.add('has-lead-dlg');
      // Phase 2 — wrap (reverse order keeps indices stable).
      for (let s = segs.length - 1; s >= 0; s--) {
        try { wrapSegment(doc, segs[s], block); } catch (e) { /* never break rendering for a quote */ }
      }
      const lastSeg = segs[segs.length - 1];
      shape.push({ el: block, has: true, endsDash: !!lastSeg.endsDash, firstShort: !!segs[0].short && segs[0].node === texts[0] });
    }
    // Collision choreography — overlap reads as interruption, not polite turn-taking:
    // a quote cut off mid-word (—") followed by another quoted line tightens the gap;
    // a short reply after a cutoff steps in underneath (compact offset + inset).
    for (let i = 0; i < shape.length; i++) {
      const a = shape[i], b = shape[i + 1];
      if (!a.has || !b || !b.has) continue;
      if (a.endsDash) {
        b.el.classList.add('tight-reply');
        if (b.firstShort) b.el.classList.add('interject');
      }
    }
  }

  // Cadence 2.0 — em/en-dashes and ellipses are TIMING, and timing has direction:
  //   —" (dash at a spoken boundary)  → a hard cutoff, tight and abrupt
  //   … / ...                         → a trailing fade-out, softly tapered
  //   — mid-line                      → a pivot, balanced breathing room
  // Walks ALL ancestors up to the fragment root (not just the immediate parent), skipping
  // code, pre, links and grammar-marked spans, so dotted leaders and dashes inside fences
  // and panes are never wrapped.
  const CADENCE_RE = /(\u2014|\u2013|\u2026|\.{3})/g;
  function cadencePass(root) {
    const doc = root.ownerDocument || document;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      let p = n.parentElement, bad = false;
      while (p) {
        const tg = p.tagName && p.tagName.toLowerCase();
        if (tg === 'code' || tg === 'pre' || tg === 'a' || (p.classList && (p.classList.contains('g-redact') || p.classList.contains('g-beat') || p.classList.contains('g-silence') || p.classList.contains('g-msg')))) { bad = true; break; }
        p = p.parentElement;
      }
      if (!bad && CADENCE_RE.test(n.textContent)) nodes.push(n);
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
        const mark = m[0];
        const after = text.slice(m.index + mark.length, m.index + mark.length + 2);
        let cls = 'cadence';
        if (mark === '\u2014' && /^\s*(["\u201D\u201C)]|$)/.test(after)) cls = 'cadence cut';       // hard cutoff at a spoken boundary
        else if (mark === '\u2026' || mark === '...') cls = 'cadence fade';                          // trailing fade-out
        else if (mark === '\u2014') cls = 'cadence pivot';                                           // mid-sentence pivot
        else cls = 'cadence pivot';
        s.className = cls;
        s.textContent = mark;
        frag.appendChild(s);
        last = m.index + mark.length;
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
