// Color FX: tags color words in rendered replies and drives ambient flares + celestial events.
// Single color → proximity-driven weighted blend + a cosmic event (supernova/comet/planet/star).
// Multiple colors on the same line → left-to-right queue cascade, each color gets its own event.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.colorfx = (function () {
  const RAW = 'red:f00,crimson:dc143c,scarlet:ff2400,vermilion:e34234,rose:ff007f,pink:ffc0cb,coral:ff7f50,salmon:fa8072,magenta:ff00ff,fuchsia:ff00ff,maroon:800000,burgundy:800020,wine:722f37,orange:ffa500,amber:ffbf00,gold:ffd700,yellow:ffff00,ivory:fffff0,cream:fffdd0,lemon:fff44f,goldenrod:daa520,olive:808000,lime:bfff00,chartreuse:7fff00,green:008000,emerald:50c878,jade:00a86b,mint:98ff98,sage:9caf88,forest:228b22,teal:008080,turquoise:40e0d0,aqua:00ffff,cyan:00ffff,azure:007fff,sky:87ceeb,blue:0000ff,navy:000080,royal:4169e1,sapphire:0f52ba,cobalt:0047ab,cerulean:2a52be,indigo:4b0082,purple:800080,violet:ee82ee,lavender:e6e6fa,lilac:c8a2c8,plum:8e4585,mauve:e0b0ff,orchid:da70d6,white:ffffff,snow:fffafa,pearl:eae0c8,silver:c0c0c0,gray:808080,grey:808080,slate:708090,charcoal:36454f,black:000000,ebony:2d231e,obsidian:0b0b0b,onyx:353839,brown:a52a2a,chocolate:d2691e,bronze:cd7f32,tan:d2b48c,beige:f5f5dc,khaki:f0e68c,sepia:704214,rust:b7410e,copper:b87333,sand:c2b280,taupe:483c32,peach:ffe5b4,apricot:ffb16d,cherry:de3163,ruby:e0115f,berry:990f4d,currant:841138,mahogany:b5394c,chestnut:954140,moss:8a9a5b,fern:4f7942,jungle:29ab87,pistachio:93c572,seafoam:80d8c0,celadon:ace1af,verdigris:43b3ae,amethyst:9966cc,garnet:733635,peridot:9dc183,citrine:e8c547,topaz:ffc87c,aquamarine:7fffd4,lapis:26619c,opal:a8c3bc,midnight:191970,dawn:f6d8ae,dusk:4e5481,twilight:5b6b8c,storm:4f666a,fog:c5c5c0,periwinkle:ccccff,denim:1560bd,powder:b0e0e6,brass:b5a642,pewter:8e9089,ochre:cc7722,umber:635147,sienna:a0522d,terracotta:e27b58,caramel:af6f4c,cocoa:463432,espresso:4b3621,wheat:f5deb3,linen:faf0e6,mustard:ffdb58,saffron:f4c430,marigold:eaa221,tangerine:f28500,persimmon:ec5800,pumpkin:ff7518,flax:eedc82,straw:e4d96f,peacock:2a728a';
  const MAP = {};
  for (const pair of RAW.split(',')) { const [n, h] = pair.split(':'); if (n && h) MAP[n.trim()] = '#' + h.trim(); }
  const NAMES = Object.keys(MAP).sort((a, b) => b.length - a.length);

  let params = { intensity: 0.5, range: 140, size: 35, blend: 'screen', events: true, fxSize: 1 };
  function setParams(p) {
    if (!p) return;
    if (p.intensity != null) params.intensity = p.intensity;
    if (p.range != null) params.range = p.range;
    if (p.size != null) params.size = p.size;
    if (p.blend != null) params.blend = p.blend;
    if (p.events != null) params.events = !!p.events;
    if (p.fxSize != null) params.fxSize = p.fxSize;
    const f = ensureFlare();
    f.style.setProperty('--flare-size', params.size + '%');
    f.style.mixBlendMode = params.blend;
  }

  function hexToRgb(hex) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length < 6) return null;
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }

  function tagColors(body) {
    if (!body) return;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement && node.parentElement.classList.contains('colorword')) continue;
      if (!node.textContent.trim()) continue;
      nodes.push(node);
    }
    for (const node of nodes) {
      const text = node.textContent;
      const nameAlt = NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const re = new RegExp('\\b(' + nameAlt + ')\\b|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\\b', 'gi');
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = re.exec(text)) !== null) {
        const word = m[0];
        const color = word.startsWith('#') ? word : MAP[word.toLowerCase()];
        if (!color) continue;
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement('span');
        span.className = 'colorword';
        span.dataset.color = color;
        span.textContent = word;
        frag.appendChild(span);
        last = m.index + word.length;
      }
      if (last === 0) continue;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  // --- The ambient flare (side-margin glow) ---
  let flare = null;
  function ensureFlare() {
    if (flare) return flare;
    flare = document.createElement('div');
    flare.id = 'colorFlare';
    flare.style.setProperty('--flare-size', params.size + '%');
    flare.style.mixBlendMode = params.blend;
    const canvas = document.getElementById('starfield');
    if (canvas && canvas.parentNode) canvas.parentNode.insertBefore(flare, canvas.nextSibling);
    else document.body.appendChild(flare);
    return flare;
  }

  // --- Celestial events: weighted archetype pool ---
  // The old ray-burst dominated and everything read as the same "pinwheel"; now soft nebulae,
  // crisp glints, expanding rings and stardust clusters share the sky, with the supernova rare.
  const FX_POOL = [
    'fx-nebula', 'fx-nebula', 'fx-glint', 'fx-glint', 'fx-ring', 'fx-ring',
    'fx-stardust', 'fx-stardust', 'fx-star', 'fx-star', 'fx-comet', 'fx-comet',
    'fx-planet', 'fx-planet', 'fx-supernova',
  ];
  let activeFx = 0;      // concurrency cap — a 15-color passage must not stack a wall of shapes
  let lastSpawnAt = 0;   // minimum spacing between spawns
  function spawnEffect(color) {
    if (!params.events) return;   // cosmic events toggled off — glow only
    const now = Date.now();
    if (activeFx >= 4 || now - lastSpawnAt < 350) return;   // declutter: cap concurrency + spacing
    let type = FX_POOL[Math.floor(Math.random() * FX_POOL.length)];
    if (type === 'fx-nebula' && document.querySelector('.fx-nebula')) type = 'fx-ring';   // one nebula at a time — two overlapping 55vmin washes overloads compositing
    const el = document.createElement('div');
    el.className = type;
    el.style.setProperty('--fx-color', color);
    const dx = Math.round(Math.random() * 240 - 120);
    const dy = Math.round(Math.random() * 180 - 90);
    el.style.setProperty('--fx-dx', dx + 'px');
    el.style.setProperty('--fx-dy', dy + 'px');
    // Variance: random rotation, size multiplier (× user event-size), texture offset, shadow angle.
    el.style.setProperty('--fx-scale', ((0.7 + Math.random() * 0.6) * params.fxSize).toFixed(2));
    el.style.setProperty('--fx-tx', Math.round(Math.random() * 8 - 4) + 'px');
    el.style.setProperty('--fx-ty', Math.round(Math.random() * 8 - 4) + 'px');
    el.style.setProperty('--fx-shadow-angle', Math.round(Math.random() * 360) + 'deg');
    // For comets: orient the tail opposite to travel direction; others: random rotation.
    if (type === 'fx-comet') el.style.setProperty('--fx-angle', Math.round(Math.atan2(dy, dx) * 180 / Math.PI) + 'deg');
    else el.style.setProperty('--fx-angle', Math.round(Math.random() * 360) + 'deg');
    if (type === 'fx-nebula') {
      // Nebulae are the wash layer: huge, faint, and free to roam the full width — the frosted
      // chat bubbles (backdrop-blur) tint through them, so color washes over the reading column.
      el.style.left = (5 + Math.random() * 90) + '%';
      el.style.top = (15 + Math.random() * 70) + '%';
      el.style.setProperty('--fx-scale', ((0.85 + Math.random() * 0.4) * params.fxSize).toFixed(2));
    } else {
      // Spread: left events roam 0–45%, right events 55–100% — the middle stays clear of the chat.
      // Vertically 10–90% so they don't cluster at mid-screen.
      const leftSide = Math.random() < 0.5;
      el.style.left = (leftSide ? Math.random() * 45 : 55 + Math.random() * 45) + '%';
      el.style.top = (10 + Math.random() * 80) + '%';
    }
    const canvas = document.getElementById('starfield');
    if (canvas && canvas.parentNode) canvas.parentNode.insertBefore(el, canvas.nextSibling);
    else document.body.appendChild(el);
    activeFx++; lastSpawnAt = now;
    const gone = function () { if (!el.parentNode) return; el.remove(); activeFx = Math.max(0, activeFx - 1); };
    el.addEventListener('animationend', gone);
    setTimeout(gone, 8000);   // safety (longest animation is 7s)
  }

  // --- Phase 2: queue cascade for multi-color lines ---
  let queueColors = null, queueIdx = 0, queueTimer = null;
  const QUEUE_MS = 1500;
  function clearQueue() { if (queueTimer) { clearTimeout(queueTimer); queueTimer = null; } queueColors = null; queueIdx = 0; }
  function startQueue(hexes) { clearQueue(); queueColors = hexes; queueIdx = 0; playQueueItem(); }
  function playQueueItem() {
    if (!queueColors || queueIdx >= queueColors.length) { clearQueue(); ensureFlare().style.opacity = '0'; return; }
    const f = ensureFlare();
    const rgb = hexToRgb(queueColors[queueIdx]);
    if (rgb) {
      f.style.setProperty('--flare-color', 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
      f.style.opacity = String(params.intensity);
      spawnEffect(queueColors[queueIdx]);   // each queued color fires its own celestial event
    }
    queueIdx++;
    queueTimer = setTimeout(playQueueItem, QUEUE_MS);
  }

  // --- Track which color words have already fired an event (one per pass) ---
  const fired = new Set();

  // --- The scan: finds nearby color words, drives flare + fires events ---
  function scan(messagesEl) {
    const f = ensureFlare();
    const centerY = window.innerHeight / 2;
    const words = messagesEl.querySelectorAll('.colorword');
    const nearby = [];
    for (const w of words) {
      const r = w.getBoundingClientRect();
      const wc = r.top + r.height / 2;
      const dist = Math.abs(wc - centerY);
      if (dist >= params.range) continue;
      const rgb = hexToRgb(w.dataset.color);
      if (!rgb) continue;
      nearby.push({ el: w, hex: w.dataset.color, rgb: rgb, dist: dist, prox: 1 - dist / params.range, x: r.left + r.width / 2, y: wc });
    }
    if (!nearby.length) { if (!queueColors) f.style.opacity = '0'; return; }

    // Clean stale fired entries (words no longer nearby can re-fire next pass).
    const nearbyEls = new Set(nearby.map(function (n) { return n.el; }));
    for (const el of fired) if (!nearbyEls.has(el)) fired.delete(el);

    // Group by vertical (same line ≈ within 24px Y).
    nearby.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    const groups = []; let cur = [nearby[0]];
    for (let i = 1; i < nearby.length; i++) {
      if (Math.abs(nearby[i].y - cur[0].y) < 24) cur.push(nearby[i]);
      else { groups.push(cur); cur = [nearby[i]]; }
    }
    groups.push(cur);

    // Pick the group closest to the scan line.
    let best = groups[0], bestAvg = best.reduce(function (s, w) { return s + w.dist; }, 0) / best.length;
    for (const g of groups) { const avg = g.reduce(function (s, w) { return s + w.dist; }, 0) / g.length; if (avg < bestAvg) { best = g; bestAvg = avg; } }

    if (best.length > 1) {
      // Multi-color line → queue cascade.
      const hexes = best.map(function (w) { return w.hex; });
      if (!queueColors || queueColors.join(',') !== hexes.join(',')) startQueue(hexes);
    } else {
      // Single color → proximity-driven weighted blend.
      clearQueue();
      let tr = 0, tg = 0, tb = 0, tw = 0, maxP = 0, maxEl = null;
      for (const w of nearby) {
        tr += w.rgb.r * w.prox; tg += w.rgb.g * w.prox; tb += w.rgb.b * w.prox; tw += w.prox;
        if (w.prox > maxP) { maxP = w.prox; maxEl = w.el; }
      }
      if (tw > 0) {
        f.style.setProperty('--flare-color', 'rgb(' + Math.round(tr / tw) + ',' + Math.round(tg / tw) + ',' + Math.round(tb / tw) + ')');
        f.style.opacity = String(maxP * params.intensity);
        // Fire a celestial event when a color word is very close to the scan line (once per pass).
        if (maxP > 0.6 && maxEl && !fired.has(maxEl)) { fired.add(maxEl); spawnEffect(nearby.find(function (n) { return n.el === maxEl; }).hex); }
      }
    }
  }

  return { tagColors: tagColors, scan: scan, setParams: setParams };
})();
