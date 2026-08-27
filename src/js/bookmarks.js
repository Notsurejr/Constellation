// Bookmarks overlay: passages you've ☆-starred across every chat.
// Opened from the 📑 button in the top bar. Click a row to load its chat and jump to the message.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.bookmarks = (function () {
  function $(id) { return document.getElementById(id); }
  const overlay = () => $('bookmarksOverlay');
  const listEl = () => $('bookmarksList');
  const countEl = () => $('bookmarksCount');

  function open() { render(); const o = overlay(); if (o) o.classList.add('open'); }
  function close() { const o = overlay(); if (o) o.classList.remove('open'); }

  async function render() {
    let bms = [];
    try { bms = await window.api.loadBookmarks(); } catch (e) {}
    bms.sort((a, b) => (b.ts || 0) - (a.ts || 0));   // newest first
    const c = countEl();
    if (c) c.textContent = bms.length ? (bms.length + ' bookmark' + (bms.length === 1 ? '' : 's')) : '';
    const list = listEl();
    if (!list) return;
    list.replaceChildren();
    if (!bms.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-empty';
      empty.textContent = 'No bookmarks yet. Hover any message and tap ☆ to save a favourite passage.';
      list.appendChild(empty);
      return;
    }
    for (const b of bms) {
      const row = document.createElement('div');
      row.className = 'bookmark-item';
      const main = document.createElement('div');
      main.className = 'bookmark-main';
      const snip = document.createElement('div');
      snip.className = 'bookmark-snip';
      snip.textContent = b.head || '(empty message)';
      const meta = document.createElement('div');
      meta.className = 'bookmark-meta';
      const glyph = document.createElement('span'); glyph.className = 'bookmark-glyph'; glyph.textContent = b.role === 'user' ? '✧' : '✦';
      const title = document.createElement('span'); title.className = 'bookmark-chat'; title.textContent = b.chatTitle || 'Untitled';
      meta.appendChild(glyph); meta.appendChild(title);
      main.appendChild(snip); main.appendChild(meta);
      main.addEventListener('click', () => jump(b));
      const del = document.createElement('button');
      del.className = 'bookmark-del'; del.type = 'button'; del.title = 'Remove bookmark'; del.textContent = '×';
      del.addEventListener('click', (e) => { e.stopPropagation(); remove(b); });
      row.appendChild(main); row.appendChild(del);
      list.appendChild(row);
    }
  }

  // Load the bookmark's chat, then scroll to (and flash) the saved message.
  async function jump(b) {
    close();
    if (window.Constellation && window.Constellation.sessions) {
      await Constellation.sessions.load(b.chatId);
      // setTimeout rather than rAF: rAF never fires while the window is occluded, and the
      // chat's bulk render needs a beat before the target row can be scrolled to.
      setTimeout(() => {
        if (Constellation.chat && Constellation.chat.scrollToMessage) Constellation.chat.scrollToMessage(b.msgIndex, b.head);
      }, 140);
    }
  }

  async function remove(b) {
    try { await window.api.removeBookmark(b.id); } catch (e) {}
    render();
    // if the removed bookmark belonged to the chat currently on screen, clear its ★
    if (window.Constellation && window.Constellation.chat && Constellation.chat.refreshBookmarkGlyphs) {
      Constellation.chat.refreshBookmarkGlyphs();
    }
  }

  function init() {
    const btn = $('bookmarksBtn'); if (btn) btn.addEventListener('click', open);
    const closeBtn = $('closeBookmarks'); if (closeBtn) closeBtn.addEventListener('click', close);
    const o = overlay();
    if (o) o.addEventListener('click', (e) => { if (e.target === o) close(); });   // click the backdrop to close
  }

  return { init, open, close, refresh: render };
})();
