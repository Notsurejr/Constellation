// Shared engines (lorebook retrieval + phrase bans) — used by BOTH the app (browser) and the CLI
// (Node), so the CLI exercises the exact same code the app runs (no divergence). UMD: in a browser
// this attaches to Constellation.engines; under Node it exports via module.exports.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Constellation = root.Constellation || {}; root.Constellation.engines = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {

  function filesBlock(files) {
    if (!files || !files.length) return '';
    return files.map((f) => '===== ' + f.name + ' (' + (f.text || '').length + ' chars) =====\n' + (f.text || '')).join('\n\n');
  }
  function simpleHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); }

  // ---------- Lorebook retrieval ----------
  const LORE_STOP = new Set(('the a an and or but of to in on at for with from by is are was were be been being it its this that these those he she they them his her their as so if then than too very can will would should could may might must do does did has have had not no we us our you your i me my').split(' '));
  const LORE_CHUNK_CHARS = 800;
  const LORE_MIN_SCORE = 1.5;
  const SEM_MIN_SIM = 0.30;
  const LORE_MAX_PASSAGES = 5;

  function loreTokenize(text) {
    return String(text || '').toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 3 && !LORE_STOP.has(w));
  }
  function loreLabel(e) {
    if (e.title) return String(e.title);
    if (e.keys && e.keys.length) return e.keys.join(', ');
    return String(e.content || '').replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  function loreSource(e) {
    return [e.content || '', filesBlock(e.files)].filter(Boolean).join('\n\n').trim();
  }
  // Stable identity for an entry (its id, or a content hash for legacy id-less entries) — used by
  // the Living Constellations sky so each entry owns one consistent star pattern.
  const eidOf = (e) => e.id || simpleHash(loreSource(e));
  function chunkText(text, maxChars) {
    maxChars = maxChars || LORE_CHUNK_CHARS;
    const paras = String(text || '').split(/\n{1,}/).map((p) => p.trim()).filter(Boolean);
    const chunks = [];
    let cur = '';
    for (const p of paras) {
      const candidate = cur ? cur + '\n' + p : p;
      if (candidate.length > maxChars && cur) { chunks.push(cur); cur = p; }
      else cur = candidate;
      while (cur.length > maxChars * 1.6) {
        let cut = cur.lastIndexOf('. ', maxChars);
        if (cut < maxChars / 2) cut = cur.lastIndexOf(' ', maxChars);
        if (cut < maxChars / 2) cut = maxChars;
        chunks.push(cur.slice(0, cut).trim());
        cur = cur.slice(cut).trim();
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(Boolean);
  }
  function bm25Scores(docs, qTokens, k1, b) {
    k1 = k1 == null ? 1.5 : k1; b = b == null ? 0.75 : b;
    const N = docs.length;
    const out = docs.map((d) => ({ d, score: 0 }));
    if (!N || !qTokens.length) return out;
    const df = {};
    for (const d of docs) { const seen = new Set(d.tokens); for (const t of seen) df[t] = (df[t] || 0) + 1; }
    const avgdl = docs.reduce((n, d) => n + d.tokens.length, 0) / N;
    const qSet = new Set(qTokens);
    for (const r of out) {
      const tf = {};
      for (const t of r.d.tokens) tf[t] = (tf[t] || 0) + 1;
      let score = 0;
      for (const t of qSet) {
        if (tf[t]) {
          const idf = Math.log((N - (df[t] || 0) + 0.5) / ((df[t] || 0) + 0.5) + 1);
          score += idf * (tf[t] * (k1 + 1)) / (tf[t] + k1 * (1 - b + b * (r.d.tokens.length / avgdl)));
        }
      }
      r.score = score;
    }
    return out;
  }
  function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  // Build the world-context payload for a turn — ONE evaluator feeding both the wire and
  // the test bench: { body, bodySurface, items, entries (per-entry diagnostics), state }.
  //   activeLore — lorebooks enabled for the chat (each { entries, semantic })
  //   recent     — the recent conversation as [{ role, content }] oldest-first (a bare
  //                string still works: one-message window, legacy callers)
  //   embedFn    — optional async (text) => unit vector | null, for semantic matching
  //   opts       — { state (eid -> { lastActive, lastFired } turn numbers), scanDepth }
  // Matching: constant entries always; keyed entries match their Trigger words against the
  // recent window (plain = any, '+key' = required, '-key' = exclude); keyless "smart"
  // entries are scored by BM25 + semantic and only their best passages fire. Inline
  // [[...]] pickups register keys from the prose itself ([[Astartes|alt1, alt2]] adds
  // aliases; [[+Warp]] / [[-dead]] are rules) and are stripped to clean prose on the wire.
  // Priority survives budget cuts first; linger keeps an entry active N turns after its
  // last match; cooldown rests it N turns after firing. Per-entry scan depth overrides the
  // global window (max 16 messages).
  const LORE_PICKUP_RE = /\[\[([^\[\]]+)\]\]/g;
  function extractPickups(text) {
    const keys = [];
    const stripped = String(text || '').replace(LORE_PICKUP_RE, (_, inner) => {
      inner = String(inner || '').trim();
      if (!inner) return '';
      const parts = inner.split('|');
      const head = parts[0].trim();
      const op = (head[0] === '+' || head[0] === '-') ? head[0] : '';
      const word = op ? head.slice(1).trim() : head;
      if (word) keys.push(op + word);
      for (let i = 1; i < parts.length; i++) { const a = parts[i].trim(); if (a) keys.push(a); }
      return word;
    });
    return { keys: keys, text: stripped };
  }
  function classifyKeys(rawKeys) {
    const any = [], must = [], not = [];
    for (const k of (rawKeys || [])) {
      const s = String(k).trim();
      if (!s) continue;
      if (s[0] === '+' && s.length > 1) must.push(s.slice(1).toLowerCase());
      else if (s[0] === '-' && s.length > 1) not.push(s.slice(1).toLowerCase());
      else any.push(s.toLowerCase());
    }
    return { any: any, must: must, not: not };
  }
  function headingKeys(text) {
    const out = [];
    for (const m of String(text || '').matchAll(/^#{1,6}\s+(.+)$/gm)) { const h = m[1].trim(); if (h) out.push(h); }
    return out;
  }
  // Key matching: word-boundary by default (so `war` never fires inside `warm`), `*` acts as
  // a wildcard (warp* → warping, warpdrive), and keys that don't start/end with ASCII word
  // characters (CJK and friends) fall back to plain substring — \b is ASCII-centric and
  // meaningless there. Compiled once per key string.
  const KEY_RX = new Map();
  function keyRx(k) {
    let rx = KEY_RX.get(k);
    if (rx !== undefined) return rx;
    const src = String(k).trim();
    if (!src) { KEY_RX.set(k, null); return null; }
    let pat = '';
    for (const ch of src.toLowerCase()) {
      if (ch === '*') { pat += '[^\\s]*'; continue; }
      pat += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const wordish = (c) => /[a-z0-9_]/i.test(c);
    if (wordish(src[0])) pat = '\\b' + pat;
    if (wordish(src[src.length - 1])) pat = pat + '\\b';
    try { rx = new RegExp(pat, 'i'); } catch (e) { rx = null; }
    KEY_RX.set(k, rx);
    return rx;
  }
  function hitKey(k, w) {
    const rx = keyRx(k);
    return rx ? rx.test(w) : false;
  }
  function loreKeyHit(keys, windowText) {
    const w = String(windowText || '');
    return keys.some((k) => hitKey(k, w));
  }
  async function buildLoreContext(activeLore, recent, embedFn, opts) {
    opts = opts || {};
    const msgs = Array.isArray(recent) ? recent : [{ role: 'user', content: String(recent || '') }];
    const turn = msgs.length;
    const state = opts.state || {};
    const defaultScan = Math.max(1, parseInt(opts.scanDepth, 10) || 4);
    const winCache = {};
    const winAt = (n) => {
      n = Math.max(1, Math.min(16, n));
      if (!winCache[n]) winCache[n] = msgs.slice(Math.max(0, msgs.length - n)).map((m) => m.content || '').join('\n').toLowerCase();
      return winCache[n];
    };
    const out = { body: '', bodySurface: '', items: [], entries: [], state: {} };
    const enabled = [];
    for (const lb of activeLore || []) for (const e of (lb.entries || [])) if (e && e.enabled) enabled.push(e);
    if (!enabled.length) return out;

    const cands = [];   // include candidates — allocated against the budget priority-first
    let seq = 0;
    const consider = (e, rawText) => {
      const eid = eidOf(e);
      const st = state[eid] || {};
      // Absent/stale state (lastActive > turn happens after a chat truncation) = never
      // matched: large deltas, so linger/cooldown can't fire from nothing.
      const sinceActive = (typeof st.lastActive === 'number' && st.lastActive <= turn) ? Math.max(0, turn - st.lastActive) : 99999;
      const sinceFired = (typeof st.lastFired === 'number' && st.lastFired <= turn) ? Math.max(0, turn - st.lastFired) : 99999;
      const priority = Math.max(1, Math.min(5, parseInt(e.priority, 10) || 3));
      const rec = { eid: eid, title: loreLabel(e), how: null, suppressed: null, included: false, cut: false, priority: priority, seq: seq++, preview: String(rawText || '').replace(/\[\[|\]\]/g, '').slice(0, 180) };
      out.entries.push(rec);
      const coolN = Math.max(0, parseInt(e.cooldown, 10) || 0);
      if (coolN > 0 && sinceFired <= coolN) rec.suppressed = 'cooldown — fired ' + sinceFired + ' turn' + (sinceFired === 1 ? '' : 's') + ' ago';
      const pickups = extractPickups(rawText);
      const cls = classifyKeys((e.keys || []).concat(pickups.keys));
      const scan = Math.max(1, parseInt(e.scanDepth, 10) || defaultScan);
      const w = winAt(scan);
      const lingerN = Math.max(0, parseInt(e.linger, 10) || 0);
      const lingering = lingerN > 0 && typeof st.lastActive === 'number' && sinceActive <= lingerN;
      const hasBoxKeys = (e.keys || []).filter((k) => String(k).trim()).length > 0;
      if (!rec.suppressed) {
        if (e.constant) rec.how = 'constant';
        else if (cls.not.length && cls.not.some((k) => hitKey(k, w))) rec.suppressed = '-not key in window';
        else if (hasBoxKeys && cls.any.length && cls.any.some((k) => hitKey(k, w)) && (!cls.must.length || cls.must.every((k) => hitKey(k, w)))) rec.how = cls.must.length ? 'keys (any + must)' : 'key match';
        else if (hasBoxKeys && !cls.any.length && cls.must.length && cls.must.every((k) => hitKey(k, w))) rec.how = 'must keys';
        else if (lingering) rec.how = 'lingering — matched ' + sinceActive + ' turns ago';
        else if (hasBoxKeys) rec.suppressed = 'no key in scan window';
        // else: keyless smart entry — its pickups are chunk-level signals, scored below
      }
      return { rec: rec, text: pickups.text };
    };
    const fire = (rec, label, text, e) => {
      cands.push({ label: label, text: text, eid: eidOf(e), depth: Math.max(0, Math.min(12, parseInt(e.depth, 10) || 0)), priority: rec.priority, seq: rec.seq, rec: rec, constant: !!e.constant });
      rec.included = true;
    };
    // Pass 1 — constant + keyed entries (whole-text fire; pickups already folded into keys).
    for (const e of enabled) {
      const src = loreSource(e);
      if (!src.trim()) continue;
      if (!(e.constant || (e.keys || []).length)) continue;
      const ev1 = consider(e, src);
      if (ev1.rec.suppressed || !ev1.rec.how) continue;
      fire(ev1.rec, loreLabel(e), ev1.text, e);
    }
    // Pass 2 — keyless smart entries: inline [[pickups]] and section headings fire their
    // chunk deterministically; the rest are scored (BM25 + semantic), best passages only.
    const smart = enabled.filter((e) => !e.constant && !(e.keys || []).length);
    const docs = [];
    const docRec = new Map(); const docEntry = new Map();
    for (const e of smart) {
      const src = loreSource(e);
      if (!src.trim()) continue;
      const ev2 = consider(e, src);
      if (ev2.rec.suppressed) continue;
      // Chunk the RAW source — inline pickups and headings are extracted PER CHUNK here,
      // not at the entry level (a 40k encyclopedia fires one section, not the whole doc).
      const stored = Array.isArray(e.chunks) && e.chunks.length ? e.chunks : null;
      const chunks = stored ? stored : chunkText(src).map((text) => ({ text }));
      let fired = false;
      for (const ch of chunks) {
        const chPick = extractPickups(ch.text);
        const chKeys = chPick.keys.concat(headingKeys(ch.text));
        const w0 = winAt(defaultScan);
        const blocked = chKeys.some((k) => k[0] === '-' && w0.includes(k.slice(1).toLowerCase()));
        if (blocked) continue;
        const pickupHit = chKeys.filter((k) => k[0] !== '-').some((k) => w0.includes(k.replace(/^[+-]/, '').toLowerCase()));
        if (pickupHit) {
          // Deterministic: an inline pickup or a section heading in this chunk matches.
          ev2.rec.how = 'chunk pickup';
          fire(ev2.rec, loreLabel(e) + ' · ' + (headingKeys(ch.text)[0] || 'pickup'), chPick.text, e);
          fired = true;
        } else {
          const doc = { label: loreLabel(e), eid: eidOf(e), tokens: loreTokenize(ch.text), text: chPick.text, vector: ch.vector };
          docs.push(doc); docRec.set(doc, ev2.rec); docEntry.set(doc, e);
        }
      }
      if (!fired && !ev2.rec.how) ev2.rec.how = 'awaiting score';
    }
    if (docs.length) {
      const queryText = winAt(defaultScan);
      const queryTokens = loreTokenize(queryText);
      const N = docs.length;
      const df = {};
      for (const d of docs) { const seen = new Set(d.tokens); for (const t of seen) df[t] = (df[t] || 0) + 1; }
      const qTerms = Array.from(new Set(queryTokens)).filter((t) => (df[t] || 0) > 0 && (df[t] / N) <= 0.5);
      let queryVec = null;
      if (embedFn && activeLore.some((lb) => lb.semantic) && docs.some((d) => d.vector)) {
        try { queryVec = await embedFn(queryText); } catch (e) { queryVec = null; }
        if (queryVec && !Array.isArray(queryVec)) queryVec = null;
      }
      const scored = bm25Scores(docs, qTerms).map((s) => ({ d: s.d, bm25: s.score, cos: queryVec && s.d.vector ? cosineSim(queryVec, s.d.vector) : 0 }));
      const scored2 = scored.filter((s) => (qTerms.length && s.bm25 >= LORE_MIN_SCORE) || s.cos >= SEM_MIN_SIM);
      if (scored2.length) {
        const rrf = (rank) => 1 / (60 + rank);
        scored2.slice().sort((a, b) => b.bm25 - a.bm25).forEach((s, i) => { s.fused = (s.fused || 0) + (qTerms.length ? rrf(i + 1) : 0); });
        scored2.slice().sort((a, b) => b.cos - a.cos).forEach((s, i) => { s.fused = (s.fused || 0) + (queryVec && s.d.vector ? rrf(i + 1) : 0); });
        scored2.sort((a, b) => b.fused - a.fused);
        let pulled = 0;
        for (const s of scored2) {
          if (pulled >= LORE_MAX_PASSAGES) break;
          const rec = docRec.get(s.d);
          if (rec.suppressed) continue;
          const howBits = [];
          if (qTerms.length && s.bm25 >= LORE_MIN_SCORE) howBits.push('BM25 ' + s.bm25.toFixed(1));
          if (s.cos >= SEM_MIN_SIM) howBits.push('sim ' + s.cos.toFixed(2));
          if (!rec.how) rec.how = howBits.join(' · ') || 'scored passage';
          fire(rec, s.d.label + ' · passage', s.d.text, docEntry.get(s.d));
          pulled++;
        }
      }
    }
    // Pass 3 — allocate the budget priority-first (higher priority survives the cut; ties
    // fall back to retrieval order). Everything beyond the budget is marked cut, and only
    // entries that actually made the wire update the linger/cooldown state. The budget is
    // user-configurable (Settings → Writing → World budget; default 8000 chars).
    const budget = Math.max(2000, Math.min(65536, parseInt(opts.budget, 10) || 8000));
    cands.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
    let used = 0;
    for (const c of cands) {
      const full = String(c.text || '');
      const piece = full.slice(0, Math.max(0, budget - used));
      if (!piece.trim()) { c.rec.cut = true; continue; }
      out.items.push({ label: c.label, text: piece, eid: c.eid, depth: c.depth, priority: c.priority, constant: !!c.constant });
      used += piece.length;
      if (piece.length < full.length) c.rec.cut = true;   // partially trimmed by the cap
    }
    for (const c of cands) if (c.rec.included && !c.rec.cut) out.state[c.eid] = { lastActive: turn, lastFired: turn };
    // World bodies: each entry rides in the same <lore:Label> fence shape the depth injections
    // use — the model can attribute every fact to its entry (bare joined text gave it no idea
    // which entry said what). opts.tag carries the renameable lore fence tag.
    const ltag = /^[A-Za-z0-9_-]{1,40}$/.test(String(opts.tag || '').trim()) ? String(opts.tag).trim() : 'lore';
    const fenceOf = (it) => { const tg = String(it.label || 'world').replace(/[<>&]/g, ''); return '<' + ltag + ':' + tg + '>\n' + it.text + '\n</' + ltag + ':' + tg + '>'; };
    out.body = out.items.map(fenceOf).join('\n\n');
    out.bodySurface = out.items.filter((it) => !(it.depth > 0)).map(fenceOf).join('\n\n');
    return out;
  }

  // ---------- Display filters (display-only regex rules) ----------
  // config/display-filters.txt, one rule per line: /pattern/flags => replacement
  // (JS regex flavor; replacement supports $1 backrefs; bare /pattern/flags = delete).
  // '#' lines are comments. A commented-OUT rule ('# /…') is a disabled rule — the Settings
  // panel toggles rules by rewriting that marker. Invalid regexes come back as {valid:false}
  // rows so the panel can show them greyed. DISPLAY-ONLY by contract: the caller applies the
  // rules to rendered bodies only — stored text, wire context and exports keep the raw source.
  function parseDisplayFilters(text) {
    const rules = [];
    for (const line of String(text || '').split('\n')) {
      const l = line.trim();
      if (!l) continue;
      const disabled = l.startsWith('#');
      const body = disabled ? l.replace(/^#\s?/, '') : l;
      if (!body.startsWith('/')) {
        if (!disabled) console.warn('[constellation] display filter: unparsed line: ' + l.slice(0, 80));
        continue;   // plain comments and stray lines are not rules
      }
      const m = body.match(/^\/(.+)\/([gimsu]*)(?:\s*=>\s*([\s\S]*))?$/);
      const base = { src: line, enabled: !disabled, label: body };
      if (!m) { rules.push(Object.assign(base, { valid: false })); continue; }
      try { rules.push(Object.assign(base, { valid: true, re: new RegExp(m[1], m[2]), repl: m[3] != null ? m[3] : '' })); }
      catch (e) { console.warn('[constellation] display filter: bad regex: ' + l.slice(0, 80)); rules.push(Object.assign(base, { valid: false })); }
    }
    return rules;
  }

  // ---------- Color words: the bank, the names that are really things, and the display tints ----------
  // Pure data + math so the unit suite can exercise them; colorfx.js does the DOM tagging.
  // A name in COLOR_EVERYDAY is a THING first — weather, a time of day, food, a plant, a gem
  // that is also a given name — so it only counts as a color inside an explicit colour
  // construction: "fog-grey", "a rose tint", "royal blue", "shades of wine".
  const COLOR_RAW = 'red:f00,crimson:dc143c,scarlet:ff2400,vermilion:e34234,rose:ff007f,pink:ffc0cb,coral:ff7f50,salmon:fa8072,magenta:ff00ff,fuchsia:ff00ff,maroon:800000,burgundy:800020,wine:722f37,orange:ffa500,amber:ffbf00,gold:ffd700,yellow:ffff00,ivory:fffff0,cream:fffdd0,lemon:fff44f,goldenrod:daa520,olive:808000,lime:bfff00,chartreuse:7fff00,green:008000,emerald:50c878,jade:00a86b,mint:98ff98,sage:9caf88,forest:228b22,teal:008080,turquoise:40e0d0,aqua:00ffff,cyan:00ffff,azure:007fff,sky:87ceeb,blue:0000ff,navy:000080,royal:4169e1,sapphire:0f52ba,cobalt:0047ab,cerulean:2a52be,indigo:4b0082,purple:800080,violet:ee82ee,lavender:e6e6fa,lilac:c8a2c8,plum:8e4585,mauve:e0b0ff,orchid:da70d6,white:ffffff,snow:fffafa,pearl:eae0c8,silver:c0c0c0,gray:808080,grey:808080,slate:708090,charcoal:36454f,black:000000,ebony:2d231e,obsidian:0b0b0b,onyx:353839,brown:a52a2a,chocolate:d2691e,bronze:cd7f32,tan:d2b48c,beige:f5f5dc,khaki:f0e68c,sepia:704214,rust:b7410e,copper:b87333,sand:c2b280,taupe:483c32,peach:ffe5b4,apricot:ffb16d,cherry:de3163,ruby:e0115f,berry:990f4d,currant:841138,mahogany:b5394c,chestnut:954140,moss:8a9a5b,fern:4f7942,jungle:29ab87,pistachio:93c572,seafoam:80d8c0,celadon:ace1af,verdigris:43b3ae,amethyst:9966cc,garnet:733635,peridot:9dc183,citrine:e8c547,topaz:ffc87c,aquamarine:7fffd4,lapis:26619c,opal:a8c3bc,midnight:191970,dawn:f6d8ae,dusk:4e5481,twilight:5b6b8c,storm:4f666a,fog:c5c5c0,periwinkle:ccccff,denim:1560bd,powder:b0e0e6,brass:b5a642,pewter:8e9089,ochre:cc7722,umber:635147,sienna:a0522d,terracotta:e27b58,caramel:af6f4c,cocoa:463432,espresso:4b3621,wheat:f5deb3,linen:faf0e6,mustard:ffdb58,saffron:f4c430,marigold:eaa221,tangerine:f28500,persimmon:ec5800,pumpkin:ff7518,flax:eedc82,straw:e4d96f,peacock:2a728a';
  const COLOR_RAW_MORE = 'carmine:960018,cerise:d2489a,amaranth:e52b50,raspberry:e30b5c,oxblood:4a0000,firebrick:b22222,indianred:cd5c5c,rosybrown:bc8f8f,darkred:8b0000,blush:de5d83,rosewood:65000b,sangria:92000a,cardinal:c41e3a,bittersweet:fd7c6c,watermelon:fc6c85,flamingo:fc8eac,bubblegum:ffc1cc,hotpink:ff69b4,lightpink:ffb6c1,dustyrose:c9a9a6,rosegold:b76e79,orangered:ff4500,tomato:ff6347,darkorange:ff8c00,carrot:ed9121,butterscotch:ffb570,lemonchiffon:fffacd,canary:ffef00,banana:ffe135,pear:d1e231,limegreen:32cd32,olivedrab:6b8e23,seagreen:2e8b57,springgreen:00ff7f,malachite:0bda51,viridian:40826d,shamrock:009e60,pine:01796f,juniper:4a6b54,mintcream:f5fffa,honeydew:f0fff0,lagoon:0f8b8d,skyblue:87ceeb,deepskyblue:00bfff,dodgerblue:1e90ff,cornflower:6495ed,ultramarine:3f00ff,steelblue:4682b0,cadetblue:5f9ea0,babyblue:89cff0,midnightblue:191970,blueviolet:8a2be2,darkviolet:9400d3,darkorchid:9932cc,mediumorchid:ba55d3,thistle:d8bfd8,rebeccapurple:663399,puce:cc8899,wisteria:c9a0dc,heliotrope:df73ff,grape:6f2da8,eggplant:614051,aubergine:514099,mulberry:c54b8c,boysenberry:873260,marsala:95525b,walnut:5c4033,cinnamon:c4652c,nutmeg:8a5a44,coffee:6f4e37,mocha:967969,toffee:94683c,fawn:e5aa70,russet:80461b,auburn:8b4c39,graphite:414a4c,dimgray:696969,lightslategray:778899,slategray:708090,darkslategray:2f4f4f,gunmetal:2a3439,platinum:e5e4e2,ghostwhite:f8f8ff,aliceblue:f0f8ff,mistyrose:ffe4e1,seashell:fff5ee,bistre:3d2b1f,smalt:003399,cinnabar:e63e31,ocher:cc7722,quartz:e8e3df,moonstone:c7e1e3,sunset:fd5e53,sunrise:fcd39e,ember:e25822,magma:ff6a2b,eclipse:341c3a,aurora:3ee6a8';
  const COLOR_BANK = {};
  for (const pair of (COLOR_RAW + ',' + COLOR_RAW_MORE).split(',')) { const kv = pair.split(':'); if (kv[0] && kv[1]) COLOR_BANK[kv[0].trim()] = '#' + kv[1].trim(); }
  const COLOR_NAMES = Object.keys(COLOR_BANK).sort((a, b) => b.length - a.length);
  const COLOR_EVERYDAY = ('sky tan fog rose wine lime jade mint sage plum snow rust sand ruby moss fern opal dawn dusk pear pine fawn coral olive lemon royal pearl peach berry storm denim cocoa wheat linen straw blush grape mocha ember magma salmon cherry jungle powder sienna tomato carrot canary banana lagoon walnut nutmeg coffee toffee quartz sunset aurora apricot currant caramel mustard pumpkin peacock sangria juniper thistle marsala sunrise eclipse charcoal midnight twilight espresso marigold cardinal flamingo shamrock honeydew wisteria eggplant mulberry cinnamon seashell chocolate pistachio tangerine persimmon raspberry watermelon butterscotch').split(' ');
  const COLOR_EVERYDAY_SET = {};
  for (const n of COLOR_EVERYDAY) COLOR_EVERYDAY_SET[n] = true;
  // A capitalized color word that opens a sentence is a NAME when a verb or a possessive follows
  // ("Amber said", "Rose's hand") — roleplay casts are full of color-named characters.
  const COLOR_NAME_AFTER = /^(?:'s\b|said|says|asked|asks|replied|answers?|answered|turned|turns|shook|shakes|nodded|nods|smiled|smiles|laughed|laughs|sighed|sighs|whispered|whispers|muttered|mutters|looked|looks|glanced|glances|stared|stares|stood|stands|sat|sits|walked|walks|ran|runs|reached|reaches|took|takes|held|holds|gave|gives|was|is|had|has|did|does|felt|feels|knew|knows|thought|thinks|wanted|wants|watched|watches|leaned|leans|paused|pauses|closed|closes|opened|opens|pressed|presses|wrapped|wraps|folded|folds|let|lets|went|goes|came|comes|began|begins|stopped|stops|kept|keeps|would|could|will|cannot|cant)\b/i;
  const COLOR_BASE_AFTER = /^(?:reds?|pinks?|roses?|oranges?|yellows?|golds?|golden|greens?|blues?|purples?|violets?|browns?|greys?|grays?|whites?|blacks?|dark|light|deep|pale|bright)\b/i;
  const COLOR_CUE_AFTER = /^(?:colou?rs?|colou?red|colou?ring|tints?|tinted|hues?|shades?|shaded|tones?|toned|dyed|stained|wash(es)?|glow(s|ing)?)\b/i;
  const COLOR_CUE_BEFORE = /(?:\bshades?\s+of|\btinges?\s+of|\btinged\s+with|\bwashed\s+with)\s*$/i;
  // Does this occurrence of a bank word read as a color here? `prev` is the text before it in
  // the same text node, `next` the text after it.
  function isColorHere(word, prev, next) {
    const w = String(word || '');
    const p = String(prev || ''), nx = String(next || '');
    const after = nx.replace(/^[\s-]+/, '');
    const sentenceStart = !p.trim() || /(?:[.!?\u2026][“\u201D\u2019)]?|[\u2014\u2013]|\n)\s*$/.test(p);
    if (/^[A-Z]/.test(w)) {
      if (!sentenceStart) return false;                         // a name mid-sentence (Amber turned)
      if (COLOR_NAME_AFTER.test(after)) return false;           // a name opening the sentence (Amber said)
    }
    if (!COLOR_EVERYDAY_SET[w.toLowerCase()]) return true;       // ordinary color name
    if ((/^-/.test(nx) || /^\s/.test(nx)) && COLOR_BASE_AFTER.test(after)) return true;   // fog-grey · royal blue
    if (/^\s/.test(nx) && COLOR_CUE_AFTER.test(after)) return true;                        // a rose tint
    if (COLOR_CUE_BEFORE.test(p)) return true;                                             // shades of wine
    return false;
  }
  let _colorPattern = null;
  // Compiled ONCE. This ~200-alternative pattern used to be rebuilt for EVERY text node
  // scanned — measured at ~180ms of a ~350ms load on a 100-turn chat (over half the render).
  function colorPattern() {
    if (!_colorPattern) {
      const alt = COLOR_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      _colorPattern = new RegExp('\\b(' + alt + ')\\b|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\\b', 'gi');
    }
    return _colorPattern;
  }

  function hexToRgb(hex) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length < 6) return null;
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }
  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
    let h = 0, s = 0; const l = (mx + mn) / 2; const d = mx - mn;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === rn) h = ((gn - bn) / d) % 6; else if (mx === gn) h = (bn - rn) / d + 2; else h = (rn - gn) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    const q = l * (1 + s), p = 2 * l - q;
    const hue = function (t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: Math.round(hue(h / 360 + 1 / 3) * 255), g: Math.round(hue(h / 360) * 255), b: Math.round(hue(h / 360 - 1 / 3) * 255) };
  }
  function relLum(c) {
    const f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrastRatio(a, b) { const la = relLum(a), lb = relLum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  // The darkest message surface a color word sits on.
  const INK_BG = { r: 8, g: 9, b: 17 };
  // Display ink for a color word: keep the hue, soften the saturation, and hold the word in
  // a soft lightness band so it reads as tinted ink — never a highlighter, and never below
  // 4.5:1 against the message. Near-white words are already ink; dark words stay the darkest
  // of the family, lifted just enough to read.
  function inkTint(hex) {
    const c = hexToRgb(hex); if (!c) return null;
    const hsl = rgbToHsl(c.r, c.g, c.b);
    if (hsl[2] >= 0.9) return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
    const s = Math.min(0.72, hsl[1] * 0.6);
    let l = hsl[2] < 0.45 ? 0.45 : Math.max(0.6, Math.min(0.76, hsl[2]));
    let rgb = hslToRgb(hsl[0], s, l);
    for (let i = 0; i < 24 && contrastRatio(rgb, INK_BG) < 4.6; i++) { l = Math.min(0.86, l + 0.02); rgb = hslToRgb(hsl[0], s, l); }
    return 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
  }
  // The light a color throws into the sky: the same hue pulled toward white, so a low-opacity
  // wash reads as light instead of mud (raw amber at 40% is brown).
  function glowTintRgb(c) {
    if (!c) return null;
    const m = function (v) { return Math.round(v + (255 - v) * 0.42); };
    return 'rgb(' + m(c.r) + ',' + m(c.g) + ',' + m(c.b) + ')';
  }
  function glowTint(hex) { return glowTintRgb(hexToRgb(hex)); }
  // Keep the old dark-hue floor for the celestial events (they should stay luminous, not soft).
  function eventTint(hex) {
    const c = hexToRgb(hex); if (!c) return null;
    const hsl = rgbToHsl(c.r, c.g, c.b);
    if (hsl[2] >= 0.45) return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
    const rgb = hslToRgb(hsl[0], hsl[1], 0.45);
    return 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
  }

  // ---------- Smart quotes (display only) ----------
  // Rendered HTML in, rendered HTML out: straight " and ' in prose become curly marks, chosen
  // from context (a quote after whitespace or an opener opens; otherwise it closes; an
  // apostrophe opens only before a letter). Code, panes and attributes are never touched, and
  // the stored text is unchanged — Copy, Edit and exports still read the raw source.
  const SQ_BLOCK = { p: 1, li: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, td: 1, th: 1, blockquote: 1, div: 1, ul: 1, ol: 1, table: 1, tr: 1, pre: 1, hr: 1 };
  const SQ_SKIP_TAG = /^(?:pre|code|kbd|samp|textarea)$/;
  const SQ_OPENER = /[\s([{<—–…«'"\u2018“-]$/;
  // Dropped-letter words ('til, 'em, 'cause) take an apostrophe, never an opener.
  const SQ_DROPPED = /^(?:em|til|cause|cept|course|round|bout|n)(?![A-Za-z])/;

  function smartQuotes(html) {
    const src = String(html == null ? '' : html);
    if (!/["']/.test(src)) return src;
    let out = '', prev = '', i = 0;
    const skip = [];   // tag names of open code/pane elements — text inside them is left alone
    const convert = function (text) {
      if (skip.length) return text;
      let s = '';
      for (let k = 0; k < text.length; k++) {
        const ch = text[k];
        if (ch !== '"' && ch !== "'") { s += ch; prev = ch; continue; }
        const startsBlock = prev === '';
        const afterOpener = startsBlock || SQ_OPENER.test(prev);
        if (ch === '"') s += afterOpener ? '“' : '”';
        else {
          const next = text[k + 1] || '';
          // Dropped-letter words (‘til, ‘em, ‘cause) and rock ‘n’ roll take an apostrophe, not an opener.
          const dropped = SQ_DROPPED.test(text.slice(k + 1, k + 8));
          const closesTiny = text[k + 2] === "'";
          s += (afterOpener && !dropped && !closesTiny && /[A-Za-z]/.test(next)) ? '\u2018' : '\u2019';
        }
        prev = ch;
      }
      return s;
    };
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      if (lt === -1) { out += convert(src.slice(i)); break; }
      if (lt > i) out += convert(src.slice(i, lt));
      const gt = src.indexOf('>', lt);
      if (gt === -1) { out += src.slice(lt); break; }
      const tag = src.slice(lt + 1, gt);
      i = gt + 1;
      out += '<' + tag + '>';
      const isClose = tag.charAt(0) === '/';
      const selfClose = /\/\s*$/.test(tag);
      const name = (isClose ? tag.slice(1) : tag).replace(/[\s/].*$/, '').toLowerCase();
      if (skip.length) { if (isClose && skip[skip.length - 1] === name) skip.pop(); else if (!isClose && !selfClose && SQ_SKIP_TAG.test(name)) skip.push(name); continue; }
      if (name === 'br') { prev = ' '; continue; }
      if (SQ_BLOCK[name]) prev = '';
      if (!isClose && !selfClose && (SQ_SKIP_TAG.test(name) || /(?:^|\s)codeblock(?:\s|$)/.test((tag.match(/class="([^"]*)"/) || [])[1] || ''))) skip.push(name);
    }
    return out;
  }

  // ---------- Phrase bans ----------
  // Rules are `find = replace` lines (or `find =` to delete); matched at word boundaries, case-insensitive.
  function parsePhraseBans(text) {
    const rules = [];
    for (const line of String(text || '').split('\n')) {
      const raw = line.trim();
      if (!raw) continue;
      const idx = raw.indexOf('=');
      const find = (idx === -1 ? raw : raw.slice(0, idx)).trim();
      const replace = idx === -1 ? '' : raw.slice(idx + 1).trim();
      if (!find) continue;
      const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try { rules.push({ re: new RegExp('\\b' + escaped + '\\b', 'gi'), replace }); } catch (e) {}
    }
    return rules;
  }
  function applyPhraseBans(text, rules) {
    if (!rules || !rules.length) return text;
    let out = text;
    for (const r of rules) out = out.replace(r.re, () => r.replace);
    return out;
  }

  return {
    filesBlock, simpleHash,
    lore: { LORE_STOP, loreTokenize, loreLabel, loreSource, chunkText, bm25Scores, cosineSim, buildLoreContext, extractPickups, classifyKeys },
    bans: { parse: parsePhraseBans, apply: applyPhraseBans },
    displayFilters: { parse: parseDisplayFilters },
    colors: { bank: COLOR_BANK, names: COLOR_NAMES, everyday: COLOR_EVERYDAY, pattern: colorPattern, isColorHere, hexToRgb, inkTint, glowTint, glowTintRgb, eventTint, contrastRatio },
    smartQuotes,
  };
});
