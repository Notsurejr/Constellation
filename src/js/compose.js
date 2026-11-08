// Compose: everything that turns the stored conversation into the exact message array
// handed to the API — the system message, attachments, preserved thinking, lore context,
// the project-instruction fence, send-time macros, and the sliding context window.
//
// PURE BY CONTRACT: all state arrives as arguments (opts, conversation/list, prompts,
// loreCtx). No closure state, no DOM, no IPC. The same inputs always compose the same
// request. This module was extracted from chat.js (v0.11.5-era split) so the request
// pipeline can be read, tested, and modified without loading the whole chat — and so
// closure-local values can never be referenced across a boundary by accident.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.compose = (function () {
  // Does this text carry any macro we substitute? (Exported: the send path gates
  // freeze-at-send on this.)
  const MACRO_HINT = /\{\{\s*(turn|roll|random|time|date)/i;

  // The newest user message — the one whose attachments still go out when "send
  // attachments" is off. One shared rule so the composer and the context meter can't drift.
  function lastUserIndex(list) {
    for (let i = list.length - 1; i >= 0; i--) { if (list[i].role === 'user') return i; }
    return -1;
  }

  // Rough token estimate (chars/4) of a message array — the usage tracker + wire estimates.
  function estTokens(msgs) {
    let c = 0;
    for (const m of msgs) { c += (m.content || '').length; if (m.reasoning_content) c += m.reasoning_content.length; }
    return Math.round(c / 4);
  }

  // ---- the system message ----

  // Render attached .md/.txt files as delimited blocks (the model sees these as reference context).
  function filesBlock(files) {
    if (!files || !files.length) return '';
    return files.map((f) => '===== ' + f.name + ' (' + (f.text || '').length + ' chars) =====\n' + (f.text || '')).join('\n\n');
  }
  // The immersion grammar, taught to the model when the toggle is on. Restraint is the whole
  // game: the mandate is a few devices per story, chosen by the moment, never explained.
  function immersionBlock() {
    return [
      '# Prose typography — immersion grammar',
      'You shape this story with typographic registers. They are part of the prose, never mentioned by you.',
      'Rules of restraint: plain prose is the default. Use at most one or two devices per scene, and only when the moment earns it. Never stack everything. Never explain the marks.',
      '- `<< line` — the origin/self world (flush left, italic). `>> line` — the present/other world (flush right, bold). For montages, contrasts, thesis couplets. The axis is origin vs here, NOT good vs bad — painful memories still belong to the self column.',
      '- Pacing: collapse to short fragments at peak stress; open into long connected sentences at calm. White space is a tempo instrument.',
      '- `!!words!!` — compressed panic. `::w o r d s::` — dissociation, reality thinning (you space the letters). Mirror images; never both at once, and rarely.',
      '- `{{word}}` — a whisper, the barely-said.',
      '- `~words~` — speech the POV character does not truly understand (foreign, machine, dream). The reader may understand it; the character must not.',
      '- `==word==` — the single word a scene turns on. At most once per scene.',
      '- `||text||` — gated content the reader chooses to reveal (hover/click). Reserve for the worst moments.',
      '- A line starting `@ ` — a cinematic establisher of time/place, like a shot change.',
      '- A paragraph starting `^` opens with a drop cap — scene or chapter openings only.',
      '- A block between `%%` lines is a centered interlude (verse, ritual, refrain).',
      '- `[[message]]` — an on-screen text or written note; `[[>message]]` — one the POV character sends.',
      '- A fenced code block tagged `file` renders as a flat document or dossier.',
    ].join('\n');
  }

  // state: { roleplayPrompt, systemFiles, projectFiles, immersion }
  // Project instructions do NOT sit here — they ride the NEWEST user turn at compose
  // time (toApiMessages), the bottom of the context, closest to generation.
  function buildSystem(state) {
    return [
      state.roleplayPrompt,
      filesBlock(state.systemFiles),
      filesBlock(state.projectFiles),
      state.immersion && immersionBlock(),
    ].filter(Boolean).join('\n\n');
  }

  // ---- send-time macros (the prompt-engine primitives) ----
  // {{turn}} {{roll:NdM}} {{random:…}} {{time}} {{date}}. `turns` is passed in (count of
  // user messages in the conversation) — derived, never stored, so forks inherit the
  // true count. Supports ST's double-colon variants ({{roll::2d6}}) alongside single-colon.
  function applySendMacros(text, turns) {
    const roll = (n, sides) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += 1 + Math.floor(Math.random() * sides);
      return sum;
    };
    return String(text)
      .replace(/\{\{\s*turn\s*\}\}/gi, String(turns))
      .replace(/\{\{\s*roll\s*:{1,2}\s*(\d*)d(\d+)\s*\}\}/gi, (m, n, s) => String(roll(Math.max(1, parseInt(n || '1', 10)), parseInt(s, 10))))
      .replace(/\{\{\s*random\s*:{1,2}\s*([^}]+?)\s*\}\}/gi, (m, list) => {
        const parts = String(list).includes('::') ? String(list).split('::') : String(list).split(',');
        const opts = parts.map((x) => x.trim()).filter(Boolean);
        return opts.length ? opts[Math.floor(Math.random() * opts.length)] : '';
      })
      .replace(/\{\{\s*time\s*\}\}/gi, new Date().toLocaleTimeString())
      .replace(/\{\{\s*date\s*\}\}/gi, new Date().toLocaleDateString());
  }

  // ---- attachments ----

  // Expand a user message's typed text + any attached file contents for the API.
  // Excluded files (the eye in edit mode) stay in the chat but never reach the model.
  function composeUserContent(m) {
    let out = m.content || '';
    const files = (m.files || []).filter((f) => !f.excluded);
    if (files.length) {
      const blocks = files.map((f) =>
        '===== Attached file: ' + f.name + ' (' + (f.text || '').length + ' chars) =====\n' + (f.text || '')
      ).join('\n\n');
      out += (out ? '\n\n' : '') + blocks;
    }
    return out;
  }

  // ---- the request assembly ----
  // toApiMessages(opts, projectInstructions, loreCtx, list) → the exact wire array.
  //   opts: generation settings (thinking, preservedThinking, sendAttachments, teachEdits)
  //   projectInstructions: the bottom-bun text ('' = no fence)
  //   loreCtx: { body } from the retrieval engine, or null
  //   list: the conversation (ALWAYS explicit — [{role, content, files?, reasoning?}…],
  //         list[0] is the system message)
  // Only request COPIES are rewritten; the source list is never mutated.
  function toApiMessages(opts, projectInstructions, loreCtx, list) {
    const preserve = !!opts.thinking && opts.preservedThinking !== false;   // GLM Preserved Thinking (user-adjustable)
    // "Send attachments" off → only the NEWEST user message keeps its files/images; older ones are
    // context ballast that can trip moderation, but the fresh attachment is the one being asked about.
    let lastUserIdx = -1;
    if (opts.sendAttachments === false) lastUserIdx = lastUserIndex(list);
    const out = list.map((m, i) => {
      if (m.role === 'user' && m.files && m.files.length) {
        const suppressed = opts.sendAttachments === false && i !== lastUserIdx;
        const files = suppressed ? [] : m.files.filter((f) => !f.excluded);
        if (!files.length) return { role: 'user', content: m.content };   // nothing sendable left
        const imgs = files.filter((f) => f.kind === 'image' && f.dataUrl);
        if (imgs.length) {
          // Multimodal content array: the typed text (+ any text files) then each image, for a vision model.
          const textParts = [m.content || ''].concat(
            files.filter((f) => f.kind !== 'image').map((f) => '===== ' + f.name + ' =====\n' + (f.text || ''))
          );
          const textJoin = textParts.filter(Boolean).join('\n\n');
          const arr = [];
          if (textJoin) arr.push({ type: 'text', text: textJoin });
          for (const f of imgs) arr.push({ type: 'image_url', image_url: { url: f.dataUrl } });
          return { role: 'user', content: arr };
        }
        return { role: 'user', content: composeUserContent(m) };   // text files only → single string
      }
      const o = { role: m.role, content: m.content };
      if (preserve && m.role === 'assistant' && m.reasoning) o.reasoning_content = m.reasoning;
      return o;
    });
    // Lorebook: inject only the RELEVANT world context (constant entries + keyword matches + the
    // top BM25 passages from big reference docs) as a clearly-labeled section. Entries with a
    // DEPTH set ride inside the message stack instead — N messages from the bottom, near the
    // action — per the depth-injection design; the system pile keeps the rest.
    if (loreCtx && loreCtx.items && loreCtx.items.length) {
      const surfaceBody = (loreCtx.bodySurface != null ? loreCtx.bodySurface : loreCtx.body);
      if (surfaceBody && out[0] && out[0].role === 'system') {
        out[0] = { role: 'system', content: out[0].content + '\n\n# World\nBackground facts about this world (true; use as context):\n\n' + surfaceBody };
      }
      for (const it of loreCtx.items) {
        const d = Math.max(1, Math.min(12, it.depth || 0));
        const target = out[Math.max(1, out.length - d)];
        if (!target) continue;
        const ltag = /^[A-Za-z0-9_-]{1,40}$/.test(String(opts.loreTag || '').trim()) ? String(opts.loreTag).trim() : 'lore';   // global fence word (Appearance/Writing), default 'lore'
        const tag = String(it.label || 'world').replace(/[<>&]/g, '');
        const fence = '\n\n<' + ltag + ':' + tag + '>\n' + it.text + '\n</' + ltag + ':' + tag + '>';
        if (typeof target.content === 'string') target.content += fence;
        else if (Array.isArray(target.content)) {
          const t = target.content.find((p) => p && p.type === 'text');
          if (t) t.text += fence;
          else target.content.push({ type: 'text', text: fence.trim() });
        }
      }
    }
    // The writer's hand (optional, off by default): your sculpted edits, shown to the model as the
    // voice it should lean toward. Disabled, edits stay entirely private to the story.
    if (opts.teachEdits && out[0] && out[0].role === 'system') {
      const pairs = list.filter((m) => m.role === 'assistant' && m.edited && m.orig && m.orig !== m.content);
      if (pairs.length) {
        const lines = pairs.slice(-10).map((m) => {
          const o = String(m.orig).replace(/\s+/g, ' ').trim().slice(0, 140);
          const n = String(m.content).replace(/\s+/g, ' ').trim().slice(0, 140);
          return '· "' + o + '" → "' + n + '"';
        });
        out[0] = { role: 'system', content: out[0].content + '\n\n# The writer\u2019s hand\nThe writer edits your replies after the fact; their edited wording is the voice they want. Lean toward it naturally — never mention or quote these notes.\n' + lines.join('\n') };
      }
    }
    // Project instructions ride the NEWEST user turn — the bottom of the context, appended
    // here at compose time ONLY. Nothing is stored in the chat (UI, session files, and lore
    // keyword scanning all see the clean prompt); the ◐ inspector sees exactly this. The
    // block survives context trimming because trimForApi always keeps the latest turn, and
    // its cost is counted because the window estimate runs on what this returns.
    if (projectInstructions) {
      // Fence tag is PER-CHAT (renameable so your system instructions can tie in by name);
      // sanitized to a fence-safe word, falling back to the classic tag.
      const safeTag = (t, fallback) => /^[A-Za-z0-9_-]{1,40}$/.test(String(t || '').trim()) ? String(t).trim() : fallback;
      const ptag = safeTag(opts.projectFenceTag, 'project_instructions');
      const ltag = safeTag(opts.loreTag, 'lore');
      const fence = '\n\n<' + ptag + '>\n' + projectInstructions + '\n</' + ptag + '>';
      const marker = '<' + ptag + '>';
      // Depth 0 (default) = the newest user turn — the bottom bun, the strongest attention.
      // A configured depth raises the fence N messages from the bottom; the target snaps to
      // the nearest user turn at or above that floor (the fence only ever rides user turns).
      const depth = Math.max(0, Math.min(12, opts.projectDepth || 0));
      let targetIdx = out.length - 1 - depth;
      while (targetIdx > 0 && out[targetIdx].role !== 'user') targetIdx--;
      if (targetIdx >= 1) {
        const target = out[targetIdx];
        if (typeof target.content === 'string') {
          if (target.content.indexOf(marker) === -1) target.content += fence;
        } else if (Array.isArray(target.content)) {
          const t = target.content.find((p) => p && p.type === 'text');
          if (t) { if (String(t.text || '').indexOf(marker) === -1) t.text = String(t.text || '') + fence; }
          else target.content.push({ type: 'text', text: fence.trim() });
        }
      }
    }
    // Card re-injection (cast chats): the compiled character/persona blocks re-enter the
    // stack at a chosen depth once the conversation grows past a trigger size — models
    // grip instructions nearest where they write, and a long chat dilutes the top-of-
    // context card. The trigger is the estimated context size in tokens BEFORE this recall;
    // 0 = the off switch (never fires). The blocks are never trimmed.
    if (opts.cardReinject > 0 && (opts.cardBlock || opts.personaBlock)) {
      const estTokens = Math.ceil(out.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length), 0) / 4);
      const trigger = Math.max(0, parseInt(opts.cardReinjectAt, 10) || 0);
      if (trigger > 0 && estTokens >= trigger) {
        const depth = Math.max(1, Math.min(12, opts.cardReinject));
        const target = out[Math.max(1, out.length - depth)];
        if (target) {
          const text = [opts.personaBlock, opts.cardBlock].filter(Boolean).join('\n\n');
          const ltag = /^[A-Za-z0-9_-]{1,40}$/.test(String(opts.loreTag || '').trim()) ? String(opts.loreTag).trim() : 'lore';
          const fence = '\n\n<' + ltag + ':card recall>\n' + text + '\n</' + ltag + ':card recall>';
          const marker = '<' + ltag + ':card recall>';
          if (typeof target.content === 'string') {
            if (target.content.indexOf(marker) === -1) target.content += fence;
          } else if (Array.isArray(target.content)) {
            const t = target.content.find((p) => p && p.type === 'text');
            if (t) { if (String(t.text || '').indexOf(marker) === -1) t.text += fence; }
            else target.content.push({ type: 'text', text: fence.trim() });
          }
        }
      }
    }
    // Send-time macros — CAST CHATS ONLY (opts.castMacros; set from the chat's character
    // field). Regular chats NEVER substitute: pasted documentation, changelogs, and prompt
    // examples that merely mention macro syntax must arrive exactly as typed. Within an
    // opted-in chat: TWO surfaces with TWO lifetimes. SYSTEM + fence macros refresh every
    // send ({{turn}} must say the current turn); MESSAGE-BODY macros are frozen by the
    // send path BEFORE this point (the stored text holds the resolved value — a rolled die
    // never re-rolls). This pass catches what's left live: the system copy and any macro
    // still standing in the newest user turn (dry-runs, probes, future callers).
    if (opts.castMacros) {
      const turns = list.filter((m) => m.role === 'user').length;
      if (out[0] && out[0].role === 'system' && MACRO_HINT.test(out[0].content)) {
        out[0] = { role: 'system', content: applySendMacros(out[0].content, turns) };
      }
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].role !== 'user') continue;
        if (typeof out[i].content === 'string' && MACRO_HINT.test(out[i].content)) {
          out[i] = { role: 'user', content: applySendMacros(out[i].content, turns) };
        } else if (Array.isArray(out[i].content)) {
          const t = out[i].content.find((p) => p && p.type === 'text');
          if (t && MACRO_HINT.test(String(t.text || ''))) {
            const copy = out[i].content.map((p) => p === t ? { type: 'text', text: applySendMacros(String(t.text || ''), turns) } : p);
            out[i] = { role: 'user', content: copy };
          }
        }
        break;   // newest user turn only
      }
    }
    return out;
  }

  // ---- the sliding context window ----
  // If a token cap is set, drop the OLDEST middle turns from what's sent (keeping the
  // system message + the latest turn) until the estimate fits. The saved conversation
  // is never touched — this only trims the array handed to the API.
  function trimForApi(contextWindow, msgs) {
    const win = Number(contextWindow) || 0;
    if (!win) return msgs;
    const sys = msgs[0] && msgs[0].role === 'system' ? msgs[0] : null;
    let body = sys ? msgs.slice(1) : msgs.slice();
    if (body.length <= 1) return msgs;
    const est = (arr) => Math.ceil(arr.reduce((n, m) => n + (m.content || '').length + (m.reasoning_content || '').length, 0) / 4);
    while (body.length > 1 && est(sys ? [sys].concat(body) : body) > win) body = body.slice(1);
    while (body.length > 1 && body[0].role === 'assistant') body = body.slice(1);   // keep it leading with a user turn
    return sys ? [sys].concat(body) : body;
  }

  return { MACRO_HINT: MACRO_HINT, lastUserIndex: lastUserIndex, estTokens: estTokens, buildSystem: buildSystem, applySendMacros: applySendMacros, composeUserContent: composeUserContent, toApiMessages: toApiMessages, trimForApi: trimForApi };
})();
