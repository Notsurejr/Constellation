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

  // '2d ago' — how long since the passage was starred.
  function relTime(ts) {
    const s = Math.max(1, Math.round((Date.now() - (ts || Date.now())) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24); if (d < 7) return d + 'd ago';
    const w = Math.round(d / 7); if (w < 5) return w + 'w ago';
    return Math.round(d / 30) + 'mo ago';
  }

  async function render() {
    let bms = [];
    try { bms = await window.api.loadBookmarks(); } catch (e) {}
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

    // Live titles: the stored title was frozen at save time (and for never-renamed chats it
    // is just the first prompt) — join against the CURRENT session list so renames show and
    // first-prompt fallbacks heal. Deleted chats keep whatever was stored.
    const live = {};
    try { for (const s of await window.api.listSessions()) live[s.id] = s.title; } catch (e) {}

    // Group by chat — headers make "which bookmark is what, and where" legible at a glance.
    // Chats order by most recent bookmark; entries within a chat read in story order.
    const groups = new Map();
    for (const b of bms) {
      const k = b.chatId || 'orphan';
      if (!groups.has(k)) groups.set(k, { title: live[k] || b.chatTitle || 'Untitled', entries: [] });
      groups.get(k).entries.push(b);
    }
    const gs = [...groups.values()];
    for (const g of gs) g.entries.sort((a, b) => (a.msgIndex || 0) - (b.msgIndex || 0));
    gs.sort((a, b) => Math.max(...b.entries.map((e) => e.ts || 0)) - Math.max(...a.entries.map((e) => e.ts || 0)));

    for (const g of gs) {
      const head = document.createElement('button');
      head.type = 'button'; head.className = 'bookmark-group-head'; head.title = 'Collapse / expand';
      const arrow = document.createElement('span'); arrow.className = 'bookmark-group-arrow'; arrow.textContent = '▾';
      const name = document.createElement('span'); name.className = 'bookmark-group-name'; name.textContent = g.title;
      const cnt = document.createElement('span'); cnt.className = 'bookmark-group-count'; cnt.textContent = g.entries.length;
      head.appendChild(arrow); head.appendChild(name); head.appendChild(cnt);
      const box = document.createElement('div'); box.className = 'bookmark-group-items';
      head.addEventListener('click', () => { box.hidden = !box.hidden; arrow.textContent = box.hidden ? '▸' : '▾'; });
      for (const b of g.entries) {
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
        const when = document.createElement('span'); when.className = 'bookmark-when'; when.textContent = 'saved ' + relTime(b.ts);
        meta.appendChild(glyph); meta.appendChild(when);
        main.appendChild(snip); main.appendChild(meta);
        main.addEventListener('click', () => jump(b));
        const del = document.createElement('button');
        del.className = 'bookmark-del'; del.type = 'button'; del.title = 'Remove bookmark'; del.textContent = '×';
        del.addEventListener('click', (e) => { e.stopPropagation(); remove(b); });
        row.appendChild(main); row.appendChild(del);
        box.appendChild(row);
      }
      list.appendChild(head);
      list.appendChild(box);
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
