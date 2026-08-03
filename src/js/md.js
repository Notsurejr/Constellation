// Markdown rendering: vendored marked + a light DOM sanitizer. Stateless — used by the chat
// renderer (and anything else that needs to turn model output into safe HTML).
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
    try { html = window.marked.parse(src, { gfm: true, breaks: true }); }
    catch (e) { return escapeHtml(src).replace(/\n/g, '<br>'); }
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    sanitizeFragment(tpl.content);
    return tpl.innerHTML;
  }
  return { render, escape: escapeHtml };
})();
