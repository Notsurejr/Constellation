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
    if (e.keys && e.keys.length) return e.keys.join(', ');
    return String(e.content || '').replace(/\s+/g, ' ').trim().slice(0, 40);
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
  // Build the world-context payload for a turn: { body, items }.
  //   activeLore — lorebooks enabled for the chat (each { entries, semantic })
  //   query      — recent conversation text (the retrieval query)
  //   embedFn    — optional async (text) => unit vector | null, for semantic matching (null = BM25-only)
  async function buildLoreContext(activeLore, query, embedFn) {
    const out = { body: '', items: [] };
    const enabled = [];
    for (const lb of activeLore) for (const e of (lb.entries || [])) if (e && e.enabled) enabled.push(e);
    if (!enabled.length) return finalizeLore(out);
    const queryTokens = loreTokenize(query);
    let budget = LORE_BUDGET_CHARS;
    const push = (label, text, eid) => {
      const piece = String(text || '').slice(0, budget);
      if (!piece.trim()) return;
      out.items.push({ label, text: piece, eid: eid });
      budget -= piece.length;
    };
    for (const e of enabled.filter((e) => e.constant)) { push(loreLabel(e), loreSource(e), eidOf(e)); if (budget <= 0) return finalizeLore(out); }
    if (query) {
      const q = query.toLowerCase();
      for (const e of enabled.filter((e) => !e.constant && (e.keys || []).length)) {
        const keys = e.keys.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
        if (keys.some((k) => q.includes(k))) { push(loreLabel(e), loreSource(e), eidOf(e)); if (budget <= 0) return finalizeLore(out); }
      }
    }
    const smart = enabled.filter((e) => !e.constant && !(e.keys || []).length);
    if (smart.length && queryTokens.length) {
      const docs = [];
      for (const e of smart) {
        const stored = Array.isArray(e.chunks) && e.chunks.length ? e.chunks : null;
        const chunks = stored ? stored : chunkText(loreSource(e)).map((text) => ({ text }));
        for (const ch of chunks) docs.push({ label: loreLabel(e), eid: eidOf(e), tokens: loreTokenize(ch.text), text: ch.text, vector: ch.vector });
      }
      const N = docs.length;
      const df = {};
      for (const d of docs) { const seen = new Set(d.tokens); for (const t of seen) df[t] = (df[t] || 0) + 1; }
      const qTerms = Array.from(new Set(queryTokens)).filter((t) => (df[t] || 0) > 0 && (df[t] / N) <= 0.5);
      let queryVec = null;
      if (embedFn && activeLore.some((lb) => lb.semantic) && docs.some((d) => d.vector)) {
        try { queryVec = await embedFn(query); } catch (e) { queryVec = null; }
        if (queryVec && !Array.isArray(queryVec)) queryVec = null;
      }
      const scored = bm25Scores(docs, qTerms).map((s) => ({ d: s.d, bm25: s.score, cos: queryVec && s.d.vector ? cosineSim(queryVec, s.d.vector) : 0 }));
      const cands = scored.filter((s) => (qTerms.length && s.bm25 >= LORE_MIN_SCORE) || s.cos >= SEM_MIN_SIM);
      if (cands.length) {
        const rrf = (rank) => 1 / (60 + rank);
        cands.slice().sort((a, b) => b.bm25 - a.bm25).forEach((s, i) => { s.fused = (s.fused || 0) + (qTerms.length ? rrf(i + 1) : 0); });
        cands.slice().sort((a, b) => b.cos - a.cos).forEach((s, i) => { s.fused = (s.fused || 0) + (queryVec && s.d.vector ? rrf(i + 1) : 0); });
        cands.sort((a, b) => b.fused - a.fused);
        let pulled = 0;
        for (const s of cands) { if (budget <= 0 || pulled >= LORE_MAX_PASSAGES) break; push(s.d.label + ' · passage', s.d.text, s.d.eid); pulled++; }
      }
    }
    return finalizeLore(out);
  }
  function finalizeLore(ctx) { ctx.body = ctx.items.map((it) => it.text).join('\n\n'); return ctx; }

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
    lore: { LORE_STOP, loreTokenize, loreLabel, loreSource, chunkText, bm25Scores, cosineSim, buildLoreContext, finalizeLore },
    bans: { parse: parsePhraseBans, apply: applyPhraseBans },
  };
});
