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
  const LORE_BUDGET_CHARS = 8000;
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
  function loreKeyHit(keys, windowText) {
    const w = String(windowText || '').toLowerCase();
    return keys.some((k) => w.includes(String(k).toLowerCase()));
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
        else if (cls.not.length && cls.not.some((k) => w.includes(k))) rec.suppressed = '-not key in window';
        else if (hasBoxKeys && cls.any.length && loreKeyHit(cls.any, w) && (!cls.must.length || cls.must.every((k) => w.includes(k)))) rec.how = cls.must.length ? 'keys (any + must)' : 'key match';
        else if (hasBoxKeys && !cls.any.length && cls.must.length && cls.must.every((k) => w.includes(k))) rec.how = 'must keys';
        else if (lingering) rec.how = 'lingering — matched ' + sinceActive + ' turns ago';
        else if (hasBoxKeys) rec.suppressed = 'no key in scan window';
        // else: keyless smart entry — its pickups are chunk-level signals, scored below
      }
      return { rec: rec, text: pickups.text };
    };
    const fire = (rec, label, text, e) => {
      cands.push({ label: label, text: text, eid: eidOf(e), depth: Math.max(0, Math.min(12, parseInt(e.depth, 10) || 0)), priority: rec.priority, seq: rec.seq, rec: rec });
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
    // entries that actually made the wire update the linger/cooldown state.
    cands.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
    let used = 0;
    for (const c of cands) {
      const full = String(c.text || '');
      const piece = full.slice(0, Math.max(0, LORE_BUDGET_CHARS - used));
      if (!piece.trim()) { c.rec.cut = true; continue; }
      out.items.push({ label: c.label, text: piece, eid: c.eid, depth: c.depth, priority: c.priority });
      used += piece.length;
      if (piece.length < full.length) c.rec.cut = true;   // partially trimmed by the cap
    }
    for (const c of cands) if (c.rec.included && !c.rec.cut) out.state[c.eid] = { lastActive: turn, lastFired: turn };
    out.body = out.items.map((it) => it.text).join('\n\n');
    out.bodySurface = out.items.filter((it) => !(it.depth > 0)).map((it) => it.text).join('\n\n');
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
  };
});
