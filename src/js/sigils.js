// The sigil picker — a prose-first symbol palette for the composer. Ordered by real writing use:
// typography and scene breaks first (the daily drivers), ornaments and mood stamps next, then
// GM flavor and esoterica for lore headers. Entries are STRINGS, not single characters — quote
// pairs insert with the caret between them, dividers insert whole. Search filters by name across
// every group; recents remember the last sixteen (the real pattern is the same glyphs, forever).
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.sigils = (function () {
  const G = [];
  function group(id, label, items) { G.push({ id: id, label: label, items: items.map(function (it) { return { c: it[0], n: it[1], k: it[2] || '' }; }) }); }

  group('type', 'Type', [
    ['—', 'em dash', 'dash break line pause'],
    ['–', 'en dash', 'dash range'],
    ['…', 'ellipsis', 'dots trailing pause'],
    ['·', 'interpunct', 'dot middot point separator'],
    ['•', 'bullet', 'dot point list'],
    ['“”', 'curly double quotes', 'quote pair speech'],
    ['‘’', 'curly single quotes', 'quote pair apostrophe'],
    ['«»', 'guillemets', 'quote pair french'],
    ['‹›', 'single guillemets', 'quote pair'],
    ['„', 'low opening quote', 'german quote'],
    ['†', 'dagger', 'obelisk footnote death'],
    ['‡', 'double dagger', 'obelisk footnote'],
    ['§', 'section', 'paragraph law'],
    ['¶', 'pilcrow', 'paragraph'],
    ['№', 'numero', 'number'],
    ['&', 'ampersand', 'and'],
    ['~', 'tilde', 'approx swing'],
    ['¦', 'broken bar', 'pipe divider'],
    ['|', 'vertical bar', 'pipe divider'],
    ['⁂', 'asterism', 'stars break divider triple'],
    ['* * *', 'asterisk break', 'scene divider break'],
  ]);
  group('breaks', 'Breaks', [
    ['⸻⸻⸻', 'heavy divider', 'scene break line divider'],
    ['— ✦ —', 'star divider', 'scene break star divider'],
    ['· · ⋯ · ·', 'quiet divider', 'soft scene break dots'],
    ['· · ⋯ ✦ ⋯ · ·', 'starlit divider', 'scene break star dots'],
    ['─────────', 'rule', 'line divider scene break'],
    ['─ ─ ─ ─ ─', 'dashed rule', 'line divider break'],
    ['❦ ❦ ❦', 'floral break', 'fleuron scene divider'],
    ['✦ ✦ ✦', 'triple star', 'scene break star'],
    ['≈≈≈', 'wave rule', 'water break divider'],
    ['·:·:·', 'dotted weave', 'pattern divider'],
    ['⌁ ⌁ ⌁', 'current divider', 'energy break'],
    ['⟡ ⟡ ⟡', 'star burst break', 'scene divider'],
  ]);
  group('ornament', 'Ornaments', [
    ['✦', 'four-pointed star', 'star cosmic sparkle'],
    ['✧', 'outlined star', 'star sparkle white'],
    ['★', 'black star', 'star'],
    ['☆', 'white star', 'star outline'],
    ['✶', 'six-pointed star', 'star'],
    ['✷', 'acute star', 'star'],
    ['✸', 'eight-pointed star', 'star compass'],
    ['❖', 'diamond ornament', 'header marker'],
    ['◆', 'black diamond', 'marker'],
    ['◇', 'white diamond', 'marker outline'],
    ['●', 'black circle', 'marker bullet'],
    ['○', 'white circle', 'marker outline'],
    ['▪', 'small square', 'marker bullet'],
    ['□', 'white square', 'marker'],
    ['※', 'reference mark', 'note attention'],
    ['⁂', 'asterism', 'stars triple'],
    ['¤', 'currency mark', 'ornament'],
    ['❧', 'rotated floral heart', 'fleuron leaf'],
    ['❥', 'rotated heart', 'leaf'],
    ['❦', 'fleuron', 'floral heart leaf'],
    ['༓', 'mark ornament', 'loop'],
    ['ཻ', 'glyph ornament', 'arc'],
    ['ᯓ★', 'sparkle star', 'decorated'],
    ['⟡', 'star burst', 'sparkle'],
    ['✵', 'turning star', 'pinwheel'],
    ['❋', 'heavy florette', 'snowflake star'],
  ]);
  group('stamp', 'Stamps', [
    ['♥', 'heart', 'love'],
    ['❤', 'heavy heart', 'love red'],
    ['🤍', 'white heart', 'love pale'],
    ['💔', 'broken heart', 'sad love grief'],
    ['💕', 'two hearts', 'love affection'],
    ['😭', 'loudly crying', 'cry sad face'],
    ['😅', 'sweat smile', 'awkward laugh face'],
    ['🥲', 'tear smile', 'bittersweet face'],
    ['😳', 'flushed', 'embarrassed blush face'],
    ['😴', 'sleeping', 'tired face'],
    ['🤔', 'thinking', 'hmm face'],
    ['💀', 'skull', 'dead face humor'],
    ['✍', 'writing hand', 'note'],
    ['👁', 'eye', 'watch gaze'],
    ['🌙', 'crescent moon', 'night scene weather'],
    ['🌑', 'new moon', 'night dark scene'],
    ['🌕', 'full moon', 'night scene'],
    ['☀', 'sun', 'day weather scene'],
    ['🌤', 'sun behind cloud', 'weather scene'],
    ['🌧', 'rain', 'weather scene storm'],
    ['⛈', 'thunderstorm', 'weather storm scene'],
    ['❄', 'snowflake', 'winter cold weather scene'],
    ['🌫', 'fog', 'mist weather scene'],
    ['🌊', 'wave', 'water sea scene'],
    ['🔥', 'fire', 'burn passion scene'],
    ['⚡', 'lightning', 'storm bolt scene'],
    ['🍃', 'leaves', 'wind spring scene'],
    ['🌧', 'cloud with rain', 'weather'],
    ['🌤️', 'sun cloud', 'weather'],
    ['🕯', 'candle', 'mood scene'],
    ['☕', 'coffee', 'morning scene'],
    ['🩸', 'blood drop', 'injury gore scene'],
    ['☕', 'hot drink', 'tea'],
    ['💢', 'anger', 'rage mood'],
    ['💤', 'zzz', 'sleep'],
    ['🫀', 'anatomical heart', 'pulse dread'],
    ['🥀', 'wilted flower', 'grief melancholy'],
  ]);
  group('gm', 'GM', [
    ['🎲', 'die', 'dice roll random d20'],
    ['⚔', 'crossed swords', 'battle fight combat'],
    ['🗡', 'dagger blade', 'weapon knife'],
    ['🛡', 'shield', 'defense armor'],
    ['🏹', 'bow', 'weapon arrow'],
    ['🔫', 'gun', 'weapon'],
    ['🗝', 'key', 'lock treasure'],
    ['📜', 'scroll', 'quest letter document'],
    ['🗺', 'map', 'journey quest'],
    ['⚗', 'alembic', 'alchemy potion lab'],
    ['🕰', 'mantelpiece clock', 'time'],
    ['💰', 'money bag', 'treasure coin'],
    ['👑', 'crown', 'king royalty'],
    ['☠', 'skull crossbones', 'death danger poison'],
    ['🜃', 'alchemy earth', 'element'],
    ['🜁', 'alchemy air', 'element'],
    ['🜂', 'alchemy fire', 'element'],
    ['🜄', 'alchemy water', 'element'],
    ['⛪', 'church', 'building'],
    ['🏰', 'castle', 'building keep'],
    ['⛰', 'mountain', 'travel'],
    ['🕳', 'hole', 'dungeon pit'],
    ['🚪', 'door', 'entrance'],
  ]);
  group('esoterica', 'Esoterica', [
    ['☿', 'mercury', 'planet zodiac alchemy'],
    ['♀', 'venus', 'planet zodiac copper'],
    ['♂', 'mars', 'planet zodiac iron'],
    ['♃', 'jupiter', 'planet zodiac tin'],
    ['♄', 'saturn', 'planet zodiac lead'],
    ['♅', 'uranus', 'planet'],
    ['♆', 'neptune', 'planet sea'],
    ['♇', 'pluto', 'planet'],
    ['♈', 'aries', 'zodiac ram'],
    ['♉', 'taurus', 'zodiac bull'],
    ['♊', 'gemini', 'zodiac twins'],
    ['♋', 'cancer', 'zodiac crab'],
    ['♌', 'leo', 'zodiac lion'],
    ['♍', 'virgo', 'zodiac maiden'],
    ['♎', 'libra', 'zodiac scales'],
    ['♏', 'scorpio', 'zorpion scorpion'],
    ['♐', 'sagittarius', 'zodiac archer'],
    ['♑', 'capricorn', 'zodiac goat'],
    ['♒', 'aquarius', 'zodiac water'],
    ['♓', 'pisces', 'zodiac fish'],
    ['⚚', 'staff of hermes', 'alchemy caduceus'],
    ['⚛', 'atom', 'science'],
    ['☥', 'ankh', 'egypt life'],
    ['☧', 'chi rho', 'sacred'],
    ['⛧', 'inverse pentagram', 'occult dark'],
    ['✝', 'latin cross', 'sacred grave'],
    ['🕯', 'black candle', 'ritual'],
    ['🜏', 'sulfur', 'alchemy occult'],
    ['○●', 'moon phases', 'cycle waxing waning'],
    ['☽☾', 'crescent pair', 'moon phases'],
  ]);
  group('marks', 'Marks', [
    ['→', 'right arrow', 'point direction'],
    ['←', 'left arrow', 'point direction'],
    ['↔', 'left-right arrow', 'direction'],
    ['⇒', 'double arrow', 'implies direction'],
    ['↳', 'down-right arrow', 'sub note point'],
    ['➤', 'arrowhead', 'point'],
    ['✓', 'check', 'yes done mark'],
    ['✗', 'cross', 'no wrong mark'],
    ['±', 'plus-minus', 'math approx'],
    ['×', 'multiplication', 'math x'],
    ['≠', 'not equal', 'math'],
    ['≈', 'almost equal', 'math approx wave'],
    ['∞', 'infinity', 'math endless'],
    ['½', 'half', 'fraction'],
    ['#', 'hash', 'number sharp'],
    ['%', 'percent', 'percent'],
    ['°', 'degree', 'angle temperature'],
    ['′', 'prime', 'feet minutes'],
    ['″', 'double prime', 'inches seconds'],
    ['⌘', 'place of interest', 'command mark'],
    ['〃', 'ditto', 'repeat'],
    ['∴', 'therefore', 'logic thus'],
  ]);

  // ---- state ----
  let pop = null, tab = 'type', query = '', recents = [];
  try { recents = JSON.parse(localStorage.getItem('sigil_recents') || '[]'); } catch (e) { recents = []; }
  function saveRecents() { try { localStorage.setItem('sigil_recents', JSON.stringify(recents)); } catch (e) {} }

  function allItems() { return G.reduce(function (a, g) { return a.concat(g.items); }, []); }

  function insert(str) {
    const input = document.getElementById('input');
    if (!input) return;
    const s = input.selectionStart != null ? input.selectionStart : input.value.length;
    const e = input.selectionEnd != null ? input.selectionEnd : s;
    // Pair entries (e.g. “”) insert with the caret between the two glyphs.
    const isPair = str.length === 2 && !/\s/.test(str);
    input.value = input.value.slice(0, s) + str + input.value.slice(e);
    const caret = s + (isPair ? 1 : str.length);
    input.focus();
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));   // autosize + draft save
    recents = [str].concat(recents.filter(function (r) { return r !== str; })).slice(0, 16);
    saveRecents();
    renderGrid();
  }

  function renderGrid() {
    if (!pop) return;
    const grid = pop.querySelector('.sigil-grid');
    const recRow = pop.querySelector('.sigil-recents');
    grid.replaceChildren();
    recRow.replaceChildren();
    recRow.hidden = !!query;
    if (!query && recents.length) {
      recents.forEach(function (r) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sigil-cell'; b.textContent = r;
        b.title = 'recent';
        b.addEventListener('click', function () { insert(r); });
        recRow.appendChild(b);
      });
    }
    const q = query.trim().toLowerCase();
    const items = q
      ? allItems().filter(function (it) { return (it.n + ' ' + it.k + ' ' + it.c).toLowerCase().indexOf(q) >= 0; }).slice(0, 120)
      : (G.find(function (g) { return g.id === tab; }) || G[0]).items;
    items.forEach(function (it) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sigil-cell'; b.textContent = it.c;
      b.title = it.n;
      b.addEventListener('click', function () { insert(it.c); });
      grid.appendChild(b);
    });
    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'sigil-empty';
      e.textContent = 'Nothing matches "' + query + '"';
      grid.appendChild(e);
    }
  }

  function renderTabs() {
    if (!pop) return;
    const tabs = pop.querySelector('.sigil-tabs');
    tabs.replaceChildren();
    G.forEach(function (g) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sigil-tab' + (g.id === tab && !query ? ' on' : '');
      b.textContent = g.label;
      b.addEventListener('click', function () { tab = g.id; query = ''; pop.querySelector('.sigil-search').value = ''; renderTabs(); renderGrid(); });
      tabs.appendChild(b);
    });
  }

  function close() {
    if (pop) { pop.remove(); pop = null; }
    const btn = document.getElementById('sigilBtn');
    if (btn) btn.classList.remove('on');
  }

  function open(btn) {
    close();
    pop = document.createElement('div');
    pop.className = 'sigil-pop';
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 340, r.right - 320)) + 'px';
    pop.style.top = Math.max(8, r.top - 330) + 'px';

    const search = document.createElement('input');
    search.type = 'text'; search.className = 'sigil-search';
    search.placeholder = 'Search sigils — "dash", "divider", "moon"…';
    search.value = query;
    search.addEventListener('input', function () { query = search.value; renderTabs(); renderGrid(); });
    const tabs = document.createElement('div'); tabs.className = 'sigil-tabs';
    const recRow = document.createElement('div'); recRow.className = 'sigil-recents';
    const grid = document.createElement('div'); grid.className = 'sigil-grid';
    const hint = document.createElement('div'); hint.className = 'sigil-hint';
    hint.textContent = 'Click to insert at the caret · stays open for stamping · Esc closes';
    pop.appendChild(search); pop.appendChild(tabs); pop.appendChild(recRow); pop.appendChild(grid); pop.appendChild(hint);
    document.body.appendChild(pop);
    btn.classList.add('on');

    const out = function (ev) { if (pop && !pop.contains(ev.target) && ev.target !== btn) { close(); document.removeEventListener('mousedown', out); } };
    setTimeout(function () { document.addEventListener('mousedown', out); }, 0);
    pop.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
    search.focus();
    renderTabs(); renderGrid();
  }

  function init() {
    const btn = document.getElementById('sigilBtn');
    if (!btn) return;
    btn.addEventListener('click', function () { if (pop) close(); else open(btn); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && pop) close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { open: open, close: close };
})();
