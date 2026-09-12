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
    } catch (e) {}
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
        else if (m[5] != null) frag.appendChild(inlineWrap(doc, m[5], 'g-whisper'));
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
  function render(text) {
    const src = String(text == null ? '' : text);
    if (!window.marked) return escapeHtml(src).replace(/\n/g, '<br>');
    ensureMarked();
    let html;
    try { html = window.marked.parse(preGrammar(src), { gfm: true, breaks: true }); }
    catch (e) { return escapeHtml(src).replace(/\n/g, '<br>'); }
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    try { postGrammar(tpl.content); } catch (e) {}
    sanitizeFragment(tpl.content);
    return tpl.innerHTML;
  }
  return { render, escape: escapeHtml };
})();
