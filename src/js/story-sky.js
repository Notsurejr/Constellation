// Story Constellations: every chat owns a constellation. One star for the story's first light,
// one more for every ★ bookmarked moment. The current chat's constellation hangs in the right
// margin — hover a star to preview its moment, click it to travel there, click the pattern itself
// to open the Sky map, where every chat you've written is a constellation in one sky.
// Same deterministic pattern language as the lore constellations; same compositing discipline
// (static SVG, opacity-only animation).
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.storySky = (function () {
  function hash32(s) {
    let h = 2166136261;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let chatId = null, chatTitle = '', bookmarks = [], el = null, warnedBirth = false;

  // Build an SVG star pattern for a chat: n stars (seed + bookmarks + one per long stretch),
  // shape deterministic from the chat id. Returns the svg plus its per-star groups.
  function buildPattern(id, n, opts) {
    opts = opts || {};
    const r = rng(hash32(id));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 90');
    svg.classList.add('story-pattern');
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([12 + r() * 96, 10 + r() * 70]);
    let d = '';
    for (let i = 1; i < Math.min(pts.length, opts.linkMax != null ? opts.linkMax + 1 : pts.length); i++) {
      d += 'M' + pts[i - 1][0].toFixed(1) + ' ' + pts[i - 1][1].toFixed(1) + ' L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1) + ' ';
    }
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'story-lines');
    svg.appendChild(path);
    const stars = pts.map((p, i) => {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'story-star' + (i === 0 ? ' seed' : ''));
      const halo = document.createElementNS(NS, 'circle');
      halo.setAttribute('cx', p[0]); halo.setAttribute('cy', p[1]); halo.setAttribute('r', i === 0 ? 5 : 4.2);
      halo.setAttribute('class', 'story-halo');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.setAttribute('r', i === 0 ? 1.8 : 1.4);
      dot.setAttribute('class', 'story-dot');
      g.appendChild(halo); g.appendChild(dot);
      svg.appendChild(g);
      return g;
    });
    return { svg: svg, stars: stars, points: pts };
  }

  function starCountFor(id, bmCount, tokens) {
    return Math.max(1, Math.min(8, 1 + (bmCount || 0) + Math.floor((tokens || 0) / 15000)));
  }

  // ---- the current chat's constellation in the right margin ----
  async function refresh() {
    if (!chatId) return;
    try {
      bookmarks = (window.Constellation.sessions && window.Constellation.sessions.bookmarksForCurrent)
        ? await window.Constellation.sessions.bookmarksForCurrent() : [];
    } catch (e) { bookmarks = []; }
    renderMargin();
  }

  function renderMargin() {
    if (!chatId) return;
    const n = 1 + bookmarks.length;
    if (el) el.remove();
    const pat = buildPattern(chatId, n);
    el = pat.svg;
    el.classList.add('story-constellation');
    const t = document.createElementNS(el.namespaceURI, 'title');
    t.textContent = chatTitle + ' — click for the Sky map';
    el.appendChild(t);
    pat.stars.forEach((g, i) => {
      if (i === 0) { g.setAttribute('data-seed', '1'); return; }   // the story's first light — not clickable
      const b = bookmarks[i - 1];
      const tt = document.createElementNS(el.namespaceURI, 'title');
      tt.textContent = '★ ' + String(b.head || 'bookmarked moment').slice(0, 80);
      g.appendChild(tt);
      g.classList.add('bookmarked');
      g.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (window.Constellation.chat && window.Constellation.chat.scrollToMessage) {
          window.Constellation.chat.scrollToMessage(b.msgIndex, b.head);
        }
      });
    });
    el.addEventListener('click', function () { openMap(); });
    document.body.appendChild(el);
    if (bookmarks.length === 1 && !warnedBirth) {
      warnedBirth = true;
      if (window.Constellation.toast) window.Constellation.toast('A star was born — your story now writes itself into the sky');
    }
  }

  function setChat(id, title) {
    chatId = id || null;
    chatTitle = title || 'Untitled';
    if (el) { el.remove(); el = null; }
    bookmarks = [];
    if (chatId) refresh();
  }

  // ---- the Sky map overlay ----
  async function openMap() {
    const overlay = document.getElementById('storyMapOverlay');
    const host = document.getElementById('storyMap');
    if (!overlay || !host) return;
    let sessions = [];
    let allBms = [];
    try { sessions = await window.api.listSessions(); } catch (e) {}
    try { allBms = await window.api.loadBookmarks(); } catch (e) {}
    sessions = sessions.filter(function (s) { return !s.hidden; });
    host.replaceChildren();
    if (!sessions.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-empty';
      empty.textContent = 'No stories yet — write something, and bookmark the moments that matter.';
      host.appendChild(empty);
    }
    const cols = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(sessions.length * 1.4))));
    sessions.forEach(function (s, idx) {
      const bm = allBms.filter(function (b) { return b.chatId === s.id; });
      const tokens = s.usage && s.usage.tokens || 0;
      const cell = document.createElement('div');
      cell.className = 'story-cell' + (s.id === chatId ? ' active' : '');
      const pat = buildPattern(s.id, starCountFor(s.id, bm.length, tokens), { linkMax: Math.min(bm.length, 6) });
      pat.svg.classList.add('story-map-pattern');
      const t = document.createElementNS(pat.svg.namespaceURI, 'title');
      t.textContent = (s.title || 'Untitled') + (bm.length ? ' — ' + bm.length + ' ★' : '');
      pat.svg.appendChild(t);
      // Brighten the bookmarked stars on the map.
      pat.stars.forEach(function (g, i) { if (i > 0 && i <= bm.length) g.classList.add('bookmarked'); });
      pat.svg.addEventListener('click', function () {
        closeMap();
        if (window.Constellation.sessions && window.Constellation.sessions.load) window.Constellation.sessions.load(s.id);
      });
      const name = document.createElement('div');
      name.className = 'story-map-name';
      name.textContent = (s.title || 'Untitled').slice(0, 26) + (bm.length ? ' ' + '★'.repeat(Math.min(bm.length, 5)) : '');
      cell.appendChild(pat.svg);
      cell.appendChild(name);
      host.appendChild(cell);
    });
    overlay.classList.add('open');
  }
  function closeMap() {
    const overlay = document.getElementById('storyMapOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  (function () {   // overlay close wiring (scripts load after the DOM)
    var c = document.getElementById('closeStoryMap');
    if (c) c.addEventListener('click', closeMap);
    var o = document.getElementById('storyMapOverlay');
    if (o) o.addEventListener('click', function (e) { if (e.target === o) closeMap(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMap(); });
  })();

  return { setChat: setChat, refresh: refresh, openMap: openMap, closeMap: closeMap };
})();
