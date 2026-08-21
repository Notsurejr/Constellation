// Living Constellations: every lorebook entry owns a small star pattern in the sky. When retrieval
// pulls from an entry, its constellation lights up and gently pulses; clicking a lit pattern opens
// a drawer showing exactly which passages were injected — a visible "context radar" for the lore.
// Patterns + home positions are derived deterministically from the entry id, so the same entry is
// always the same shape in the same spot: the sky becomes a recognizable map of your world.
// Compositing budget: tiny static SVGs, opacity-only animation — no filters, no backdrop captures.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.stars = (function () {
  const registry = new Map();   // eid -> { el, timer, info }

  function hash32(s) {
    let h = 2166136261;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {   // mulberry32 — deterministic per entry
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeEl(eid, label) {
    const r = rng(hash32(eid));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 90');
    svg.classList.add('lore-star');
    const title = document.createElementNS(svg.namespaceURI, 'title');
    title.textContent = label || 'Lore';
    svg.appendChild(title);
    const n = 4 + Math.floor(r() * 4);   // 4–7 stars
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([10 + r() * 100, 8 + r() * 74]);
    let d = '';
    for (let i = 1; i < pts.length; i++) {
      d += 'M' + pts[i - 1][0].toFixed(1) + ' ' + pts[i - 1][1].toFixed(1) +
           ' L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1) + ' ';
    }
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'lore-star-lines');
    svg.appendChild(path);
    pts.forEach((p, i) => {
      const halo = document.createElementNS(svg.namespaceURI, 'circle');
      halo.setAttribute('cx', p[0]); halo.setAttribute('cy', p[1]); halo.setAttribute('r', 3.4);
      halo.setAttribute('class', 'lore-star-halo');
      svg.appendChild(halo);
      const dot = document.createElementNS(svg.namespaceURI, 'circle');
      dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.setAttribute('r', i === 0 ? 1.7 : 1.1);
      dot.setAttribute('class', 'lore-star-dot');
      svg.appendChild(dot);
    });
    const left = r() < 0.5;   // deterministic home in the outer margins, clear of the chat column
    svg.style.left = (left ? 2 + r() * 13 : 83 + r() * 13) + '%';
    svg.style.top = (8 + r() * 74) + '%';
    return svg;
  }

  // ---- the inspector drawer ----
  let drawer = null;
  function closeDrawer() { if (drawer) { drawer.remove(); drawer = null; } }
  function openDrawer(eid) {
    closeDrawer();
    const rec = registry.get(eid);
    if (!rec || !rec.info) return;
    drawer = document.createElement('div');
    drawer.className = 'lore-drawer';
    const h = document.createElement('div');
    h.className = 'lore-drawer-title';
    const name = document.createElement('span'); name.textContent = '❖ ' + rec.info.label;
    const x = document.createElement('button'); x.className = 'lore-drawer-close'; x.type = 'button'; x.textContent = '×'; x.title = 'Close';
    x.addEventListener('click', (ev) => { ev.stopPropagation(); closeDrawer(); });
    h.appendChild(name); h.appendChild(x);
    drawer.appendChild(h);
    rec.info.texts.forEach((t, i) => {
      const n = document.createElement('div'); n.className = 'lore-drawer-n'; n.textContent = 'Passage ' + (i + 1);
      const p = document.createElement('div'); p.className = 'lore-drawer-p'; p.textContent = String(t);
      drawer.appendChild(n); drawer.appendChild(p);
    });
    const hint = document.createElement('div'); hint.className = 'lore-drawer-hint';
    hint.textContent = 'What the model was given from this entry';
    drawer.appendChild(hint);
    document.body.appendChild(drawer);
    setTimeout(() => {   // dismiss on the next outside click
      const out = (ev) => { if (drawer && !drawer.contains(ev.target)) { closeDrawer(); document.removeEventListener('click', out); } };
      document.addEventListener('click', out);
    }, 0);
  }

  // Called with the retrieval result after each reply: light up every entry that contributed.
  function illuminate(items) {
    if (!items || !items.length) return;
    const byEntry = new Map();
    for (const it of items) {
      if (!it || !it.eid) continue;
      if (!byEntry.has(it.eid)) byEntry.set(it.eid, { label: String(it.label || '').replace(/ · passage$/, ''), texts: [] });
      byEntry.get(it.eid).texts.push(it.text);
    }
    for (const [eid, info] of byEntry) {
      let rec = registry.get(eid);
      if (!rec) {
        const el = makeEl(eid, info.label);
        el.addEventListener('click', (ev) => { ev.stopPropagation(); openDrawer(eid); });
        const host = document.getElementById('starfield');
        if (host && host.parentNode) host.parentNode.insertBefore(el, host.nextSibling);
        else document.body.appendChild(el);
        rec = { el: el, timer: null, info: info };
        registry.set(eid, rec);
      } else {
        rec.info = info;
      }
      rec.el.classList.remove('lit');
      void rec.el.getBoundingClientRect();   // restart the pulse
      rec.el.classList.add('lit');
      clearTimeout(rec.timer);
      rec.timer = setTimeout(() => rec.el.classList.remove('lit'), 9000);   // then settles to a faint memory
    }
    // Don't accumulate forever: past 14 patterns, drop the oldest unlit ones.
    if (registry.size > 14) {
      for (const [eid, rec] of registry) {
        if (registry.size <= 14) break;
        if (rec.el.classList.contains('lit')) continue;
        clearTimeout(rec.timer); rec.el.remove(); registry.delete(eid);
      }
    }
  }

  return { illuminate: illuminate };
})();
