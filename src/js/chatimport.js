// Chat Importer — converts chat exports from other platforms/exporters into native
// Constellation sessions. Pure text-in/text-out: the renderer modal and the unit suite
// both call the same functions, so what the preview shows is exactly what gets saved.
//
// Supported containers: Anthropic exports (conversations.json + single-chat chat_messages),
// ChatGPT exports (conversations.json mapping trees, walked from current_node), Google AI
// Studio JSON (chunkedPrompt.chunks), SillyTavern .jsonl (swipes → variants), Constellation
// JSON backups (native fields preserved, multi-session → checklist), four markdown dialects
// (Claude MD, ChatGPT/Gemini MD, Obsidian callouts incl. mdexport round-trip, AI Studio
// pasted MD), a fence-aware generic repeating-marker fallback, and fully custom markers.
//
// Output contract (one shape for every format):
//   parse(text, opts) → { format, multiChat, chats: [{ title, date, count, system?, turns?, warnings? }], warnings, rawPreview? }
//   Multi-chat containers return metadata only; parseOne(text, index, opts) normalizes one
//   selected chat lazily (huge 50MB+ exports parse once, previews per selection).
//   Unknown text returns { format: 'unknown', rawPreview } — the modal opens straight into
//   the custom-markers editor instead of a dead end.
// opts: { includeThinking=false, includeSystem=true, swapRoles=false, chatIndex?,
//         userMarker?, assistantMarker?, thinkMarker? }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Constellation = root.Constellation || {}; root.Constellation.chatimport = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {

  // ---------- small utils ----------
  function escapeRegExp(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function estimateTokens(text) { return Math.ceil(String(text || '').length / 4); }
  function firstLines(text, n) { return String(text || '').split(/\r?\n/).slice(0, n).join('\n'); }
  function deriveTitle(turns) {
    for (const t of turns) if (t.role === 'user' && t.content) return String(t.content).replace(/\s+/g, ' ').trim().slice(0, 42) || 'Imported chat';
    return 'Imported chat';
  }
  // exporter timestamp lines sitting right under a section header
  function looksLikeTimestamp(line) {
    return /^\d{4}-\d{1,2}-\d{1,2}([T\s]\d{1,2}:\d{2}(:\d{2})?)?\s*(am|pm)?\s*$/i.test(line.trim())
      || /^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\s*$/i.test(line.trim())
      || /^\([A-Za-z]{3},?\s+\d{1,2}\s+[A-Za-z]{3}.*\)\s*$/.test(line.trim());
  }

  // fence-state tracker: toggles on ``` / ~~~ lines so marker scanning can ignore
  // everything inside pasted examples, changelogs and code
  function makeFenceTracker() {
    let inFence = false, fenceToken = '';
    return {
      get inFence() { return inFence; },
      feed(line) {
        const m = /^\s*(```|~~~)/.exec(line);
        if (m) {
          if (!inFence) { inFence = true; fenceToken = m[1]; }
          else if (line.trim().startsWith(fenceToken)) { inFence = false; fenceToken = ''; }
        }
        return inFence;
      },
    };
  }

  // ---------- JSON shape sniffing ----------
  function tryParse(text) {
    try { return JSON.parse(String(text || '')); } catch (e) { return undefined; }
  }
  function isCharacterCard(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
    const d = (j.data && (j.data.name || j.data.description)) ? j.data : j;
    return !!(d && d.name && (d.description !== undefined || d.personality !== undefined || d.first_mes !== undefined || d.scenario !== undefined));
  }
  function stripApiKeys(j) {
    // backups are shareable — any api_key field found anywhere is stripped on import
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 6) return;
      for (const k of Object.keys(o)) {
        if (k === 'api_key') { delete o[k]; continue; }
        walk(o[k], depth + 1);
      }
    };
    walk(j, 0);
    return j;
  }

  // ---------- shared normalization ----------
  // raw turns: [{ role: 'user'|'assistant', content, reasoning?, model?, variants?, vActive? }]
  function normalizeTurns(rawTurns, opts, warnings) {
    opts = opts || {};
    warnings = warnings || [];
    let raw = rawTurns.map((t) => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: String(t.content || ''),
      reasoning: t.reasoning ? String(t.reasoning) : undefined,
      model: t.model ? String(t.model) : undefined,
      variants: Array.isArray(t.variants) ? t.variants : undefined,
      vActive: Number.isInteger(t.vActive) ? t.vActive : undefined,
    }));
    if (opts.swapRoles) raw = raw.map((t) => Object.assign({}, t, { role: t.role === 'user' ? 'assistant' : 'user' }));

    // thinking option FIRST (default OFF — stripped with a counted warning): a
    // thinking-only chunk must count as stripped, not silently vanish as "empty"
    if (!opts.includeThinking) {
      const withThink = raw.filter((t) => String(t.reasoning || '').trim()).length;
      for (const t of raw) delete t.reasoning;
      if (withThink) warnings.push('Stripped ' + withThink + ' thinking block' + (withThink === 1 ? '' : 's') + ' (Include thinking is off)');
    }

    // drop empty turns
    const nonEmpty = [];
    let droppedEmpty = 0;
    for (const t of raw) {
      if (!String(t.content || '').trim() && !String(t.reasoning || '').trim()) { droppedEmpty++; continue; }
      nonEmpty.push(t);
    }
    if (droppedEmpty) warnings.push('Dropped ' + droppedEmpty + ' empty turn' + (droppedEmpty === 1 ? '' : 's'));

    // merge consecutive same-role turns
    const merged = [];
    let mergedCount = 0;
    for (const t of nonEmpty) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === t.role) {
        prev.content = (prev.content ? prev.content + '\n\n' : '') + t.content;
        if (t.reasoning) prev.reasoning = prev.reasoning ? prev.reasoning + '\n\n' + t.reasoning : t.reasoning;
        if (t.model) prev.model = t.model;
        if (t.variants && t.variants.length) prev.variants = t.variants;
        if (Number.isInteger(t.vActive)) prev.vActive = t.vActive;
        mergedCount++;
      } else merged.push(t);
    }
    if (mergedCount) warnings.push('Merged ' + mergedCount + ' consecutive same-role turn' + (mergedCount === 1 ? '' : 's'));

    if (merged.length && merged[0].role === 'assistant') {
      warnings.push('Starts with an assistant greeting — kept as-is (some providers require a user turn first)');
    }
    return { turns: merged, warnings };
  }

  function finalize(title, turns, warnings, system, opts, date) {
    const out = { title: title || deriveTitle(turns), date: date || undefined, count: turns.length, turns, warnings };
    if (system && String(system).trim()) {
      if (opts.includeSystem !== false) out.system = String(system).trim();   // includeSystem defaults ON
      else out.warnings = out.warnings.concat(['System prompt from the export was dropped (Include system prompt is off)']);
    }
    return out;
  }

  // ---------- Anthropic (chat_messages / conversations.json) ----------
  function parseAnthropicChat(chatObj, opts, warnings) {
    const raw = [];
    let toolBlocks = 0;
    for (const msg of (chatObj.chat_messages || [])) {
      const role = msg.sender === 'human' ? 'user' : 'assistant';
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const texts = [];
      const thinks = [];
      for (const b of blocks) {
        if (b && b.type === 'text' && String(b.text || '').trim()) texts.push(String(b.text));
        else if (b && b.type === 'thinking' && String(b.thinking || '').trim()) thinks.push(String(b.thinking));
        else toolBlocks++;
      }
      raw.push({ role, content: texts.join('\n\n'), reasoning: thinks.join('\n\n') || undefined });
    }
    if (toolBlocks) warnings.push('Skipped ' + toolBlocks + ' tool-use / non-text block' + (toolBlocks === 1 ? '' : 's'));
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize(chatObj.name || chatObj.title || '', norm.turns, warnings, undefined, opts, chatObj.created_at);
  }

  // ---------- ChatGPT (mapping tree, walked from current_node) ----------
  function parseChatgptChat(chatObj, opts, warnings) {
    const mapping = chatObj.mapping || {};
    let node = chatObj.current_node;
    const chain = [];
    const seen = new Set();
    while (node && mapping[node] && !seen.has(node)) {
      seen.add(node);
      chain.unshift(mapping[node]);
      node = mapping[node].parent;
    }
    const raw = [];
    let skipped = 0;
    for (const n of chain) {
      const msg = n.message;
      if (!msg) continue;
      const role = msg.author && msg.author.role;
      if (role !== 'user' && role !== 'assistant') { skipped++; continue; }
      const c = msg.content || {};
      if (c.content_type && c.content_type !== 'text' && c.content_type !== 'user_editable_context') { skipped++; continue; }
      const text = Array.isArray(c.parts) ? c.parts.filter((p) => typeof p === 'string').join('') : '';
      if (!String(text).trim()) { skipped++; continue; }
      const model = (msg.metadata && msg.metadata.model_slug) || undefined;
      raw.push({ role: role === 'user' ? 'user' : 'assistant', content: text, model: role === 'assistant' ? model : undefined });
    }
    if (skipped) warnings.push('Skipped ' + skipped + ' system / tool / empty node' + (skipped === 1 ? '' : 's'));
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize(chatObj.title || '', norm.turns, warnings, undefined, opts, chatObj.create_time ? new Date(chatObj.create_time * 1000).toISOString() : undefined);
  }

  // ---------- Google AI Studio (chunkedPrompt.chunks) ----------
  function parseAiStudioChat(j, opts, warnings) {
    const chunks = (j.chunkedPrompt && j.chunkedPrompt.chunks) || j.chunks || [];
    const raw = [];
    for (const c of chunks) {
      const role = c.role === 'user' ? 'user' : 'assistant';
      if (c.isThought) { raw.push({ role, content: '', reasoning: String(c.text || '') }); continue; }
      raw.push({ role, content: String(c.text || '') });
    }
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize('', norm.turns, warnings, undefined, opts);
  }

  // ---------- SillyTavern (.jsonl / array form) ----------
  function parseStChat(lines, opts, warnings) {
    const raw = [];
    for (const line of lines) {
      let j = line;
      if (typeof line === 'string') { try { j = JSON.parse(line); } catch (e) { continue; } }
      if (!j || typeof j !== 'object' || (!('mes' in j) && !('swipes' in j))) continue;
      const role = j.is_user ? 'user' : 'assistant';
      let variants, vActive;
      if (Array.isArray(j.swipes) && j.swipes.length > 1) {
        variants = j.swipes.map((s) => ({ content: String(s || '') }));
        const at = j.swipes.indexOf(j.mes);
        vActive = at === -1 ? 0 : at;
      }
      raw.push({ role, content: String(j.mes || ''), variants, vActive, model: (!j.is_user && j.name) ? String(j.name) : undefined });
    }
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize('', norm.turns, warnings, undefined, opts);
  }

  // ---------- Constellation backup / session (native passthrough) ----------
  function parseConstellationSession(sess, opts, warnings) {
    const raw = (sess.messages || []).map((m) => ({
      role: m.role, content: String(m.content || ''),
      reasoning: m.reasoning ? String(m.reasoning) : undefined,
      model: m.model ? String(m.model) : undefined,
      variants: Array.isArray(m.variants) ? m.variants : undefined,
      vActive: Number.isInteger(m.vActive) ? m.vActive : undefined,
    }));
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize(sess.title || '', norm.turns, warnings, sess.system, opts, sess.updatedAt);
  }

  // ---------- markdown shared preprocessing ----------
  // strips leading YAML frontmatter (harvesting title/model/date) and a leading
  // [!summary] callout + --- divider; returns { text, title, model, date }
  function preprocessMarkdown(text) {
    const out = { text: String(text || ''), title: undefined, model: undefined, date: undefined };
    let lines = out.text.split(/\r?\n/);
    if (lines[0] && lines[0].trim() === '---') {
      let i = 1;
      for (; i < lines.length; i++) {
        if (lines[i].trim() === '---') break;
        const m = /^(title|model|date):\s*(.*)$/i.exec(lines[i]);
        if (m) {
          const v = m[2].replace(/^["']|["']$/g, '').trim();
          if (/^title$/i.test(m[1])) out.title = v;
          else if (/^model$/i.test(m[1])) out.model = v;
          else if (/^date$/i.test(m[1])) out.date = v;
        }
      }
      if (i < lines.length) lines = lines.slice(i + 1);   // closing --- found; else keep original (a lone --- is content)
    }
    let start = 0;
    while (start < lines.length && !lines[start].trim()) start++;
    if (start < lines.length && /^\s*>\s*\[!summary\]/i.test(lines[start])) {
      start++;
      while (start < lines.length && /^\s*>/.test(lines[start])) start++;
      while (start < lines.length && !lines[start].trim()) start++;
      if (start < lines.length && lines[start].trim() === '---') start++;
      while (start < lines.length && !lines[start].trim()) start++;
      lines = lines.slice(start);
    }
    out.text = lines.join('\n');
    return out;
  }

  // ---------- Claude MD (## User / ## Claude / ## Assistant) ----------
  function parseMdClaude(text, opts, warnings, pre) {
    const lines = text.split(/\r?\n/);
    const fence = makeFenceTracker();
    const sections = [];
    let cur = null;
    let thinkMode = false;
    let thinkTag = false;   // inside an unterminated <thinking> block
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const header = !fence.inFence && /^##+\s*(user|claude|assistant|human|model)\s*:?\s*$/i.exec(line.trim());
      if (header) {
        if (cur) sections.push(cur);
        const roleWord = header[1].toLowerCase();
        cur = { role: (roleWord === 'user' || roleWord === 'human') ? 'user' : 'assistant', content: [], reasoning: [], model: undefined, firstLineSeen: false };
        thinkMode = false; thinkTag = false;
        continue;
      }
      if (!cur) continue;
      fence.feed(line);
      const trimmed = line.trim();
      if (!cur.firstLineSeen && trimmed && looksLikeTimestamp(trimmed)) { cur.firstLineSeen = true; continue; }
      cur.firstLineSeen = cur.firstLineSeen || !!trimmed;
      const mm = /^\*\*Model:\*\*\s*(.+)$/i.exec(trimmed);
      if (mm) { cur.model = mm[1].trim(); continue; }
      if (!fence.inFence && /^###?\s*thinking\s*$/i.test(trimmed)) { thinkMode = true; continue; }
      if (!fence.inFence && /^<thinking>\s*$/i.test(trimmed)) { thinkTag = true; thinkMode = true; continue; }
      if (thinkTag && /<\/thinking>/i.test(trimmed)) { thinkTag = false; thinkMode = false; continue; }
      if (thinkMode) {
        if (thinkTag) { cur.reasoning.push(line); continue; }   // <thinking> block: only its closing tag ends it
        // Real Claude thinking blocks are multi-paragraph. A block ends at the next
        // ###-heading (### Response / ### Answer …), a --- divider, </details>, or the
        // next turn header — and only falls back to ending at a blank line when no
        // such closer exists before the next turn. Structural closers (### Response /
        // ### Answer) and <details> wrapper markup are dropped; other headings stay.
        if (/^<details>/i.test(trimmed) || /^<summary>/i.test(trimmed) || /^<\/summary>/i.test(trimmed)) continue;
        const structural = /^###?\s+(?:response|answer)\b/i.test(trimmed);
        const closer = /^###?\s+(?!thinking\b)/i.test(trimmed) || /^---\s*$/.test(trimmed) || /^<\/details>\s*$/i.test(trimmed);
        if (closer) {
          thinkMode = false;
          if (!/^---/.test(trimmed) && !structural && !/^<\/details>/i.test(trimmed)) cur.content.push(line);
          continue;
        }
        if (!trimmed) {
          // paragraph break inside thinking — keep the block open only if a real closer
          // appears before the next turn header; otherwise the answer follows the blank
          let closer = false, turn = false, f = fence.inFence;
          for (let j = i + 1; j < lines.length; j++) {
            const l = lines[j], lt = l.trim();
            if (/^\s*(```|~~~)/.test(l)) { f = !f; continue; }
            if (!lt) continue;
            if (!f && /^#{2}\s*(user|claude|assistant|human|model)\b/i.test(lt)) { turn = true; break; }
            if (!f && (/^###?\s+(?!thinking\b)/i.test(lt) || /^---\s*$/.test(lt) || /<\/details>/i.test(lt))) { closer = true; break; }
          }
          if (!closer && !turn) thinkMode = false;   // plain answer follows the blank
          else cur.reasoning.push('');               // paragraph break inside the block
          continue;
        }
        cur.reasoning.push(line);
        continue;
      }
      cur.content.push(line);
    }
    if (cur) sections.push(cur);
    const raw = sections.map((s) => ({
      role: s.role,
      content: s.content.join('\n').replace(/^\n+|\n+$/g, ''),
      reasoning: s.reasoning.join('\n').replace(/^\n+|\n+$/g, '') || undefined,
      model: s.model,
    }));
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize(pre && pre.title, norm.turns, warnings, undefined, opts, pre && (pre.date || pre.model && undefined));
  }

  // ---------- ChatGPT / Gemini raw MD (## Prompt: / ## Response:) ----------
  function parseMdChatgpt(text, opts, warnings, pre) {
    const lines = text.split(/\r?\n/);
    const fence = makeFenceTracker();
    const sections = [];
    let cur = null;
    let inThink = false;
    for (const line of lines) {
      const header = !fence.inFence && /^#{2,3}\s*(prompt|response|question|answer)\s*:\s*(.*)$/i.exec(line.trim());
      if (header) {
        if (cur) sections.push(cur);
        const roleWord = header[1].toLowerCase();
        cur = { role: (roleWord === 'prompt' || roleWord === 'question') ? 'user' : 'assistant', content: header[2] ? [header[2]] : [], reasoning: [] };
        inThink = false;
        continue;
      }
      if (!cur) continue;
      fence.feed(line);
      const trimmed = line.trim();
      if (!fence.inFence && /^>\s*(thinking|\*\*thinking:?\*\*)\s*:?\s*$/i.test(trimmed)) { inThink = true; continue; }
      if (inThink) {
        if (/^>/.test(line)) { cur.reasoning.push(line.replace(/^>\s?/, '')); continue; }
        inThink = false;   // unquoted line ends the thinking blockquote
      }
      cur.content.push(line);
    }
    if (cur) sections.push(cur);
    const raw = sections.map((s) => ({
      role: s.role,
      content: s.content.join('\n').replace(/^\n+|\n+$/g, ''),
      reasoning: s.reasoning.join('\n').replace(/^\n+|\n+$/g, '') || undefined,
    }));
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize(pre && pre.title, norm.turns, warnings, undefined, opts, pre && pre.date);
  }

  // ---------- Obsidian callouts (Gemini exports + Constellation mdexport round-trip) ----------
  function parseMdCallout(text, opts, warnings, pre) {
    const lines = text.split(/\r?\n/);
    const sections = [];
    let cur = null;
    let fenceOpen = false;
    let pendingThinkOn = false;   // [!abstract] thinking emitted BEFORE its [!NOTE] (mdexport order)
    let pendingThink = '';
    for (const line of lines) {
      const stripped = /^>\s?/.test(line) ? line.replace(/^>\s?/, '') : line;   // exactly ONE leading '>' layer
      if (/^\s*(```|~~~)/.test(stripped)) fenceOpen = !fenceOpen;
      const co = !fenceOpen && /^\s*>\s*\[!(question|note|abstract|quote|answer|assistant|user)\](.*)$/i.exec(line);
      if (co) {
        const type = co[1].toLowerCase();
        const label = String(co[2] || '').replace(/^[-\s]*/, '').replace(/✦/g, '').trim();
        if (type === 'abstract') {
          // thinking AFTER an assistant answer attaches to it; thinking BEFORE a note
          // (mdexport order) is buffered and attached when the note starts. The callout
          // header line itself never becomes content.
          if (cur && cur.role === 'assistant') cur.thinkAppend = true;
          else pendingThinkOn = true;
          continue;
        }
        if (type === 'quote' && /system/i.test(label)) { cur = { role: 'system', content: [], thinkAppend: false }; sections.push(cur); continue; }
        const model = type === 'note' ? (label.split('·')[0].trim() || undefined) : undefined;
        cur = { role: (type === 'question' || type === 'user') ? 'user' : 'assistant', content: [], reasoning: pendingThinkOn ? [pendingThink] : [], model, thinkAppend: false };
        pendingThinkOn = false;
        pendingThink = '';
        sections.push(cur);
        continue;
      }
      if (pendingThinkOn) { pendingThink += '\n' + stripped; continue; }   // still collecting pre-note thinking
      if (!cur) continue;
      if (cur.role === 'system') { cur.content.push(stripped); continue; }
      if (cur.thinkAppend) { cur.reasoning.push(stripped); continue; }
      cur.content.push(stripped);
    }
    let system;
    const raw = [];
    for (const s of sections) {
      if (s.role === 'system') { system = s.content.join('\n').replace(/^\n+|\n+$/g, ''); continue; }
      raw.push({
        role: s.role,
        content: s.content.join('\n').replace(/^\n+|\n+$/g, ''),
        reasoning: s.reasoning.join('\n').replace(/^\n+|\n+$/g, '') || undefined,
        model: s.model,
      });
    }
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize(pre && pre.title, norm.turns, warnings, system, opts, pre && pre.date);
  }

  // ---------- AI Studio pasted MD (> User blockquotes) ----------
  function parseMdAiStudio(text, opts, warnings, pre) {
    const lines = text.split(/\r?\n/);
    const fence = makeFenceTracker();
    const sections = [];
    let cur = null;
    for (const line of lines) {
      const marker = !fence.inFence && /^>\s*user\s*:?\s*$/i.exec(line.trim());
      if (marker) {
        if (cur) sections.push(cur);
        cur = { role: 'user', content: [] };
        continue;
      }
      if (!cur) continue;
      fence.feed(line);
      if (cur.role === 'user') {
        if (/^>/.test(line)) { cur.content.push(line.replace(/^>\s?/, '')); continue; }
        // an unquoted line hands off to the model's answer (blank lines included)
        sections.push(cur);
        cur = { role: 'assistant', content: [line] };
        continue;
      }
      cur.content.push(line);   // the answer accumulates, blank lines included
    }
    if (cur) sections.push(cur);
    const raw = sections.map((s) => ({ role: s.role, content: s.content.join('\n').replace(/^\n+|\n+$/g, '') }));
    const norm = normalizeTurns(raw, opts, warnings);
    return finalize(pre && pre.title, norm.turns, warnings, undefined, opts, pre && pre.date);
  }

  // ---------- generic repeating-marker fallback + custom markers ----------
  // header-style markers (standalone ### lines) overlap the specialized MD parsers, so
  // generic-header detection only fires when BOTH roles use them and neither side is
  // exclusively a specialized dialect; inline markers (**User:** / Me:) never collide.
  const GENERIC_PATTERNS = [
    { re: /^#{1,4}\s*(?:human|user|me|you|q)\s*:?\s*$/i, role: 'user', kind: 'header' },
    { re: /^#{1,4}\s*(?:assistant|ai|bot|claude|chatgpt|gemini|model|gpt)\s*:?\s*$/i, role: 'assistant', kind: 'header' },
    { re: /^\*\*(?:user|human|me|q)\s*:?\*\*\s*/i, role: 'user', kind: 'inline' },
    { re: /^\*\*(?:assistant|ai|bot|char|gpt)\s*:?\*\*\s*/i, role: 'assistant', kind: 'inline' },
    { re: /^(?:user|human|me)\s*:\s+/i, role: 'user', kind: 'inline' },
    { re: /^(?:assistant|ai|bot)\s*:\s+/i, role: 'assistant', kind: 'inline' },
  ];
  function matchGeneric(line) {
    for (const p of GENERIC_PATTERNS) if (p.re.test(line.trim())) return p;
    return null;
  }
  function scanGenericMarkers(text) {
    const fence = makeFenceTracker();
    const g = { user: 0, assistant: 0, inlineUser: 0, inlineAssistant: 0, headerUser: 0, headerAssistant: 0, nonShared: 0 };
    const SHARED = /^(?:human|user|assistant|claude|model)$/i;
    for (const line of String(text || '').split(/\r?\n/)) {
      if (fence.feed(line)) continue;
      const p = matchGeneric(line);
      if (!p) continue;
      const token = line.trim().replace(/^#{1,4}\s*/, '').replace(/[:*]+\s*$/, '').trim();
      if (!SHARED.test(token)) g.nonShared++;
      if (p.role === 'user') { g.user++; if (p.kind === 'inline') g.inlineUser++; else g.headerUser++; }
      else { g.assistant++; if (p.kind === 'inline') g.inlineAssistant++; else g.headerAssistant++; }
    }
    return g;
  }
  // markers: { userMarker?, assistantMarker?, thinkMarker? } — explicit overrides
  function parseGeneric(text, opts, warnings, pre, markers) {
    const um = markers && markers.userMarker ? new RegExp('^\\s*' + escapeRegExp(markers.userMarker) + '\\s*:?\\s*(.*)$', 'i') : null;
    const am = markers && markers.assistantMarker ? new RegExp('^\\s*' + escapeRegExp(markers.assistantMarker) + '\\s*:?\\s*(.*)$', 'i') : null;
    const tm = markers && markers.thinkMarker ? new RegExp('^\\s*' + escapeRegExp(markers.thinkMarker) + '\\s*:?\\s*(.*)$', 'i') : null;
    const lines = String(text || '').split(/\r?\n/);
    const fence = makeFenceTracker();
    const sections = [];
    let cur = null;
    let pendingThink = null;   // think-marker content buffers and attaches to the NEXT assistant turn
    for (const line of lines) {
      fence.feed(line);
      if (fence.inFence) { if (cur) cur.content.push(line); continue; }   // markers inside fences never split turns
      // role markers are checked FIRST — even inside a thinking section, or the marker
      // that ends it would be swallowed as thinking
      let role = null, rest = '';
      if (um) { const m = um.exec(line); if (m) { role = 'user'; rest = m[1] || ''; } }
      if (!role && am) { const m = am.exec(line); if (m) { role = 'assistant'; rest = m[1] || ''; } }
      if (!role && !um && !am) {
        const p = matchGeneric(line);
        if (p) { role = p.role; rest = line.trim().replace(p.re, '').trim(); }
      }
      if (role) {
        if (cur) sections.push(cur);
        cur = { role, content: rest ? [rest] : [], reasoning: pendingThink ? [pendingThink] : [] };
        pendingThink = null;
        continue;
      }
      if (tm) {
        const t = tm.exec(line);
        if (t) { pendingThink = (pendingThink ? pendingThink + '\n' : '') + (t[1] || ''); continue; }
      }
      if (pendingThink !== null) { pendingThink += '\n' + line; continue; }
      if (!cur) continue;
      cur.content.push(line);
    }
    if (cur && pendingThink !== null) cur.reasoning = [pendingThink];   // trailing thinking attaches to the last turn
    if (cur) sections.push(cur);
    const raw = sections.map((s) => ({
      role: s.role,
      content: s.content.join('\n').replace(/^\n+|\n+$/g, ''),
      reasoning: s.reasoning.join('\n').replace(/^\n+|\n+$/g, '') || undefined,
    }));
    const norm = normalizeTurns(raw, opts, warnings);   // swapRoles applied here
    return finalize(pre && pre.title, norm.turns, warnings, undefined, opts, pre && pre.date);
  }

  // ---------- detection ----------
  function detectFormat(text) {
    const t = String(text || '');
    if (!t.trim()) return null;
    const trimmed = t.trimStart();
    // JSONL: the first line is an object that smells like a SillyTavern turn
    if (trimmed.startsWith('{') && /\r?\n\s*\{/.test(t)) {
      const first = t.split(/\r?\n/).find((l) => l.trim());
      try { const j = JSON.parse(first); if (j && ('mes' in j || 'is_user' in j)) return 'st_jsonl'; } catch (e) {}
    }
    const j = tryParse(t);
    if (j && typeof j === 'object') {
      if (Array.isArray(j)) {
        if (j.length && j[0] && j[0].chat_messages) return 'anthropic';
        if (j.length && j[0] && j[0].mapping) return 'chatgpt';
        if (j.length && j[0] && ('is_user' in j[0] || 'mes' in j[0])) return 'st_jsonl';
        if (j.length && j[0] && Array.isArray(j[0].messages)) return 'constellation';
        if (j.length && j[0] && j[0].role && j[0].content) return 'json_generic';
        return null;
      }
      if (j.app === 'constellation') return 'constellation';
      if (j.chat_messages) return 'anthropic';
      if (j.mapping && j.current_node) return 'chatgpt';
      if (j.chunkedPrompt || (j.chunks && Array.isArray(j.chunks))) return 'aistudio';
      if ('mes' in j || 'is_user' in j) return 'st_jsonl';
      if (isCharacterCard(j)) return 'card';
      if (Array.isArray(j.messages)) {
        // a native session (system/gen/usage present) vs a bare role/content list
        return (j.system !== undefined || j.gen || j.usage) ? 'constellation' : 'json_generic';
      }
      return null;
    }
    // markdown family — detection runs on frontmatter/summary-stripped text
    const pre = preprocessMarkdown(t);
    const md = pre.text;
    const g = scanGenericMarkers(md);
    if (g.inlineUser >= 1 && g.inlineAssistant >= 1) return 'generic';   // inline markers never collide with the specialized dialects
    if (/^\s*>\s*\[!(question|note)\]/im.test(md)) return 'md_callout';
    // Claude MD needs a Claude-branded non-user header — bare "### Human / ### AI" belongs to the generic fallback
    const claudeMdHeader = /^#{2,3}\s*(user|claude|assistant|human|model)\s*:?\s*$/im.test(md);
    const claudeBranded = /^#{2,3}\s*(claude|assistant|model)\s*:?\s*$/im.test(md);
    if (claudeMdHeader && (claudeBranded || !g.headerAssistant)) return 'md_claude';
    if (/^#{2,3}\s*(prompt|response)\s*:/im.test(md)) return 'md_chatgpt';
    if (/^>\s*user\s*:?\s*$/im.test(md)) return 'md_aistudio';
    if (g.headerUser >= 1 && g.headerAssistant >= 1) return 'generic';
    return 'unknown';
  }

  // ---------- multi-chat metadata (lazy: one JSON.parse, no per-chat normalization) ----------
  function list(text) {
    const j = tryParse(text);
    if (!j || typeof j !== 'object') return { format: detectFormat(text), multiChat: false, chats: [] };
    const chats = [];
    if (Array.isArray(j) && j.length && j[0] && j[0].chat_messages) {
      for (const c of j) chats.push({ index: chats.length, title: c.name || c.title || '', date: c.created_at || '', count: (c.chat_messages || []).length });
      return { format: 'anthropic', multiChat: true, chats };
    }
    if (Array.isArray(j) && j.length && j[0] && j[0].mapping) {
      for (const c of j) chats.push({ index: chats.length, title: c.title || '', date: c.create_time ? new Date(c.create_time * 1000).toISOString() : '', count: Object.keys(c.mapping || {}).length });
      return { format: 'chatgpt', multiChat: true, chats };
    }
    if (j.app === 'constellation' && j.sessions && typeof j.sessions === 'object') {
      for (const sid of Object.keys(j.sessions)) {
        const s = j.sessions[sid];
        chats.push({ index: chats.length, title: s.title || '', date: s.updatedAt ? new Date(s.updatedAt).toISOString() : '', count: (s.messages || []).length });
      }
      return { format: 'constellation', multiChat: true, chats };
    }
    return { format: detectFormat(text), multiChat: false, chats: [] };
  }

  // ---------- parse one selected chat from a multi-chat container ----------
  function parseOne(text, index, opts) {
    const j = tryParse(text);
    if (!j || typeof j !== 'object') return { format: 'unknown', multiChat: false, chats: [], warnings: [] };
    let chatObj = null;
    if (Array.isArray(j) && j[0] && j[0].chat_messages) chatObj = j[index];
    else if (Array.isArray(j) && j[0] && j[0].mapping) chatObj = j[index];
    else if (j.app === 'constellation' && j.sessions && typeof j.sessions === 'object') {
      const sid = Object.keys(j.sessions)[index];
      chatObj = sid ? j.sessions[sid] : null;
      if (chatObj) stripApiKeys(chatObj);
    }
    if (!chatObj) return { format: 'unknown', multiChat: false, chats: [], warnings: [] };
    const warnings = [];
    if (chatObj.chat_messages) return { format: 'anthropic', multiChat: false, chats: [parseAnthropicChat(chatObj, opts, warnings)], warnings };
    if (chatObj.mapping) return { format: 'chatgpt', multiChat: false, chats: [parseChatgptChat(chatObj, opts, warnings)], warnings };
    if (chatObj.messages) {
      const chat = parseConstellationSession(chatObj, opts, warnings);
      if (chatObj.project) chat.project = String(chatObj.project);
      if (chatObj.character) chat.character = chatObj.character;
      return { format: 'constellation', multiChat: false, chats: [chat], warnings };
    }
    return { format: 'unknown', multiChat: false, chats: [], warnings };
  }

  // ---------- parse entry ----------
  function parse(text, opts) {
    opts = opts || {};
    const format = detectFormat(text);
    if (!format) return { format: 'unknown', multiChat: false, chats: [], warnings: [], rawPreview: firstLines(text, 25) };
    if (format === 'card') return { format: 'card', multiChat: false, chats: [], warnings: [] };
    if (format === 'st_jsonl') {
      const warnings = [];
      const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
      return { format, multiChat: false, chats: [parseStChat(lines, opts, warnings)], warnings };
    }
    if (format === 'json_generic') {
      const j = tryParse(text);
      const warnings = [];
      const raw = (j.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant')).map((m) => ({ role: m.role, content: String(m.content || '') }));
      const norm = normalizeTurns(raw, opts, warnings);
      return { format, multiChat: false, chats: [finalize(j.title || '', norm.turns, warnings, undefined, opts)], warnings };
    }
    if (format === 'constellation') {
      const j = stripApiKeys(tryParse(text));
      if (j.app === 'constellation' && j.sessions && typeof j.sessions === 'object') {
        // multi-session backup → metadata checklist; parseOne normalizes a selection
        const chats = [];
        for (const sid of Object.keys(j.sessions)) {
          const s = j.sessions[sid];
          chats.push({ index: chats.length, title: s.title || '', date: s.updatedAt ? new Date(s.updatedAt).toISOString() : '', count: (s.messages || []).length });
        }
        return { format, multiChat: true, chats, warnings: [] };
      }
      const warnings = [];
      const chat = parseConstellationSession(j, opts, warnings);
      if (j.project) chat.project = String(j.project);
      if (j.character) chat.character = j.character;
      return { format, multiChat: false, chats: [chat], warnings };
    }
    if (format === 'anthropic') {
      const j = tryParse(text);
      if (Array.isArray(j)) return { format, multiChat: true, chats: list(text).chats, warnings: [] };
      return { format, multiChat: false, chats: [parseAnthropicChat(j, opts, [])], warnings: [] };
    }
    if (format === 'chatgpt') {
      const j = tryParse(text);
      if (Array.isArray(j)) return { format, multiChat: true, chats: list(text).chats, warnings: [] };
      return { format, multiChat: false, chats: [parseChatgptChat(j, opts, [])], warnings: [] };
    }
    if (format === 'aistudio') {
      const warnings = [];
      return { format, multiChat: false, chats: [parseAiStudioChat(tryParse(text), opts, warnings)], warnings };
    }
    const pre = preprocessMarkdown(text);
    const warnings = [];
    if (format === 'unknown') return { format, multiChat: false, chats: [], warnings, rawPreview: firstLines(text, 25) };
    let chat = null;
    if (format === 'md_claude') chat = parseMdClaude(pre.text, opts, warnings, pre);
    else if (format === 'md_chatgpt') chat = parseMdChatgpt(pre.text, opts, warnings, pre);
    else if (format === 'md_callout') chat = parseMdCallout(pre.text, opts, warnings, pre);
    else if (format === 'md_aistudio') chat = parseMdAiStudio(pre.text, opts, warnings, pre);
    else if (format === 'generic') chat = parseGeneric(pre.text, opts, warnings, pre);
    return { format, multiChat: false, chats: [chat], warnings };
  }

  // explicit custom markers — always parses, whatever the text looks like
  function parseCustom(text, opts) {
    const pre = preprocessMarkdown(text);
    const warnings = [];
    const chat = parseGeneric(pre.text, opts, warnings, pre, { userMarker: opts.userMarker, assistantMarker: opts.assistantMarker, thinkMarker: opts.thinkMarker });
    return { format: 'custom', multiChat: false, chats: [chat], warnings };
  }

  return { detect: detectFormat, list, parse, parseOne, parseCustom, estimateTokens, normalizeTurns, isCharacterCard };
});
