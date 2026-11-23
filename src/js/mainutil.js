// Pure helpers extracted from main.js so the unit suite (tests/unit/) can exercise them
// in plain Node without loading Electron. main.js requires this file and uses everything
// exactly as before — these are the SAME functions, moved verbatim (mainutil must stay
// dependency-free beyond Node builtins: zlib here, nothing else).
const zlib = require('zlib');

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// Every settings.txt key in ONE table: getSettings parses it, config:load returns it,
// config:save writes it. Adding a setting = one row here + the renderer wiring — no more
// three scattered lists drifting apart. Kinds preserve the original parser semantics
// exactly (including "0/garbage/absent falls back to the default" where that was the case).
//   ['txt key', 'response field', kind, default, ...kind args]
const SETTINGS_SPEC = [
  ['api_key', 'apiKey', 'key', ''],
  ['model', 'model', 'str', 'glm-5.3'],
  ['base_url', 'baseUrl', 'str', 'https://open.bigmodel.cn/api/paas/v4/'],
  ['temperature', 'temperature', 'float', 0.8],
  ['top_p', 'topP', 'float', 0.95],
  ['max_tokens', 'maxTokens', 'int', 65536],                                 // GLM-5.x provider default
  ['thinking', 'thinking', 'onoff', false],
  ['reasoning_effort', 'reasoningEffort', 'enum', 'max', ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']],
  ['font_scale', 'fontScale', 'clampedFloat', 1, 0.8, 1.6],
  ['chat_width', 'chatWidth', 'clampedInt', 880, 600, 1500],
  ['accent', 'accent', 'hex', ''],
  ['stream_cps', 'streamCps', 'clampedInt', 0, 0, 2000],                   // 0 = instant
  ['star_density', 'starDensity', 'clampedFloat', 1, 0.2, 2.5],
  ['twinkle_speed', 'twinkleSpeed', 'clampedFloat', 1, 0, 2.5],            // 0 = frozen
  ['context_window', 'contextWindow', 'clampedInt', 0, 0, 1000000],        // 0 = unlimited
  ['cli_server', 'cliServer', 'onoff', false],
  ['teach_edits', 'teachEdits', 'onoff', false],
  ['preserved_thinking', 'preservedThinking', 'onoff', true],
  ['immersion', 'immersion', 'onoff', false],
  ['last_backup', 'lastBackup', 'int', 0],
  ['md_thinking', 'mdThinking', 'onoff', true],
  ['dialogue_style', 'dialogueStyle', 'enum', 'off', ['off', 'chiaroscuro', 'glass', 'editorial', 'acoustic', 'dramatis', 'noir']],
  ['dialogue_vividness', 'dialogueVividness', 'enum', 'balanced', ['subtle', 'balanced', 'vivid']],
  ['speaker_accent_quotes', 'speakerAccent', 'onoff', false],
  ['grammar_style', 'grammarStyle', 'enum', 'literary', ['literary', 'stage', 'kinetic', 'ink']],
  ['redact_style', 'redactStyle', 'enum', 'bar', ['bar', 'blur', 'scramble']],
  ['cadence_marks', 'cadenceMarks', 'onoff', false],
  ['stream_ink', 'streamInk', 'onoff', false],
  ['ui_font', 'uiFont', 'enum', 'Literata', ['Literata', 'Atkinson']],
  ['chat_layout', 'chatLayout', 'enum', 'folio', ['folio', 'bubbles']],
  ['glass_style', 'glassStyle', 'enum', 'gradient', ['gradient', 'frost', 'tinted', 'smoked', 'shelf', 'vignette']],
  ['response_window', 'responseWindow', 'enum', 'none', ['none', 'void', 'soft', 'glass']],
  ['code_pane_style', 'codePaneStyle', 'enum', 'recessed', ['recessed', 'floating', 'hairline', 'classic']],
  ['project_depth', 'projectDepth', 'clampedInt', 0, 0, 12],
  ['lore_tag', 'loreTag', 'str', 'lore'],
  ['lore_budget', 'loreBudget', 'clampedInt', 8000, 2000, 65536],
  ['cache_safe_lore', 'cacheSafeLore', 'onoff', false],
  ['enable_macros', 'enableMacros', 'onoff', false],
  ['pane_teach', 'paneTeach', 'onoff', true],
  ['preserved_thinking_depth', 'preservedThinkingDepth', 'clampedInt', 0, 0, 99],
  ['send_attachments', 'sendAttachments', 'onoff', true],
  ['sidebar_sort', 'sidebarSort', 'enum', 'recent', ['recent', 'name', 'size']],
  ['flare_intensity', 'flareIntensity', 'clampedFloat', 0.5, 0, 1],
  ['flare_range', 'flareRange', 'clampedInt', 140, 50, 400],
  ['flare_size', 'flareSize', 'clampedInt', 35, 20, 100],
  // Key keeps its old name (flare_blend) so existing settings files load; its old values
  // (screen / normal / soft-light / overlay) fall back to the default — soft-light and overlay
  // emitted no light over the black sky, and screen and normal were identical there.
  ['flare_blend', 'flareBlend', 'enum', 'soft', ['soft', 'even', 'tight']],
  ['fx_events', 'fxEvents', 'onoff', true],
  ['fx_size', 'fxSize', 'clampedFloat', 1, 0.4, 2.5],
  ['color_words', 'colorWords', 'onoff', true],
  ['mood_sky', 'moodSky', 'onoff', true],
  ['font_family', 'fontFamily', 'enum', 'Literata', ['Literata', 'Newsreader', 'Lora', 'Atkinson Hyperlegible']],
  ['line_height', 'lineHeight', 'clampedFloat', 1.65, 1.3, 2.1],
  ['prose_measure', 'proseMeasure', 'str', 'off'],
];

function readSetting(row, raw) {
  const v = raw[row[0]];
  const def = row[3];
  switch (row[2]) {
    case 'key': return v || process.env.ZAI_API_KEY || '';
    case 'str': return v || def;
    case 'float': { const n = parseFloat(v); return isNaN(n) ? def : n; }
    case 'int': return parseInt(v, 10) || def;
    case 'clampedInt': return clamp(parseInt(v, 10) || def, row[4], row[5]);
    case 'clampedFloat': return clamp(parseFloat(v) || def, row[4], row[5]);
    case 'onoff': return v === undefined ? def : /^(on|true|1)$/i.test(v || '');
    case 'enum': return row[4].includes(v) ? v : def;
    case 'hex': return /^#[0-9a-f]{6}$/i.test(v || '') ? v : '';
    default: return def;
  }
}

// ---------- IPC hardening ----------
// Every handler that touches a file by a renderer-supplied id validates it here: plain word
// characters only (no dots/slashes), which blocks path traversal ("../../") if the renderer is
// ever compromised. Defense in depth behind contextIsolation + the markdown sanitizer + CSP.
function safeId(id) {
  return (typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)) ? id : null;
}

function cardId(name) {
  const base = String(name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'character';
  return 'c_' + base + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

// PNG character cards: the spec embeds the card JSON in a PNG text chunk, base64-encoded —
// keyword 'chara' (v2) or 'ccv3' (v3). Supports tEXt (plain) and zTXt (zlib-compressed).
function extractCardFromPng(buf) {
  if (!buf || buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;   // PNG signature
  const out = {};
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tEXt') {
      const data = buf.slice(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = data.toString('latin1', 0, nul);
        out[key] = data.slice(nul + 1).toString('latin1');
      }
    } else if (type === 'zTXt') {
      const data = buf.slice(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = data.toString('latin1', 0, nul);
        if (data[nul + 1] === 0) {   // compression method 0 = zlib
          // maxOutputLength caps decompression-bomb chunks (a ~62KB hostile card could
          // otherwise inflate to GBs inside the main process); over the cap throws and
          // the chunk is skipped — the import fails cleanly.
          try { out[key] = zlib.inflateSync(data.slice(nul + 2), { maxOutputLength: 8 * 1024 * 1024 }).toString('latin1'); } catch (e) { console.warn('[constellation]', e && e.message || e); }
        }
      }
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  for (const key of ['ccv3', 'chara']) {   // v3 first when both exist
    if (out[key]) {
      try { return JSON.parse(Buffer.from(out[key], 'base64').toString('utf8')); }
      catch (e) { console.warn('[constellation]', e && e.message || e); }
    }
  }
  return null;
}

function normalizeCard(raw) {
  // chara_card_v2 wraps fields in `data`; JanitorAI/Chub exports sometimes carry them at the
  // root. Accept both, prefer the wrapper when present.
  const d = (raw && raw.data && (raw.data.name || raw.data.description)) ? raw.data : raw;
  if (!d || !d.name) return null;
  const sysPrompt = String(d.system_prompt || '');
  const phi = String(d.post_history_instructions || '');
  return {
    name: String(d.name).slice(0, 80),
    description: String(d.description || ''),
    personality: String(d.personality || ''),
    scenario: String(d.scenario || ''),
    firstMes: String(d.first_mes || d.greeting || ''),
    altGreetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map(String) : [],
    mesExample: String(d.mes_example || ''),
    tags: Array.isArray(d.tags) ? d.tags.map(String).slice(0, 12) : [],
    creator: String(d.creator || ''),
    avatarUrl: String(d.avatar || ''),
    characterBook: d.character_book && Array.isArray(d.character_book.entries) && d.character_book.entries.length ? d.character_book : null,
    // The card's own steering (system_prompt / post_history_instructions) — kept as TEXT now
    // so start-chat can offer them as a base; the yes/no flags stay for pre-0.9.6 records.
    systemPrompt: sysPrompt.trim() ? sysPrompt : '',
    postHistory: phi.trim() ? phi : '',
    hasSystemPrompt: !!sysPrompt.trim(),
    hasPhi: !!phi.trim(),
    spec: String(raw && raw.spec || 'chara_card_v2'),
  };
}

// ---------- Helpers for retries ----------
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Should we retry this error? Transient issues yes; bad key / out-of-credits no.
function isRetryable(err) {
  const status = err && err.status;
  const msg = String((err && err.message) || '');
  if (/余额|insufficient.{0,14}(balance|quota|credit)/i.test(msg)) return false; // billing — retrying won't help
  if (status === 429) return true;                          // genuine rate limit
  if (status && status >= 500 && status < 600) return true; // server error
  if (status === 408 || status === 409) return true;
  if (!status) return true;                                  // no HTTP status -> network/timeout
  return false;
}

function localDateStamp() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
}

function estTok(s) { return Math.round((String(s || '').length) / 4); }

// Backups are made to be shared and parked in cloud folders — the API key never leaves the
// machine inside one. The key line is blanked on export; on restore, an empty incoming key
// yields to the local one (restoring your own backup shouldn't log you out).
function redactSettingsText(text) {
  return String(text || '').replace(/^([ \t]*)api_key:.*$/m, '$1api_key: ');
}
function mergeKeyOnRestore(incomingText, currentText) {
  const inKey = (String(incomingText || '').match(/^([ \t]*)api_key:[ \t]*(.*)$/m) || [])[2] || '';
  if (inKey.trim()) return String(incomingText || '');
  const curKey = (String(currentText || '').match(/^([ \t]*)api_key:[ \t]*(.*)$/m) || [])[2] || '';
  if (!curKey.trim()) return String(incomingText || '');
  return String(incomingText || '').replace(/^([ \t]*)api_key:.*$/m, '$1api_key: ' + curKey.trim());
}

// Gemini's OpenAI-compat door streams thought summaries INLINE inside content as
// <thought>…</thought>. Peel them into the think channel so the reply body stays clean
// prose. Stateful PER STREAM (markers can straddle chunks, so a short tail is held back
// until the marker is ruled out) — one factory call per stream.
function createGeminiSplit() {
  let gInThought = false;
  let gHold = '';
  function split(piece) {
    let text = '', think = '';
    gHold += piece;
    for (;;) {
      const marker = gInThought ? '</thought>' : '<thought>';
      const at = gHold.indexOf(marker);
      if (at === -1) {
        const keep = Math.min(gHold.length, marker.length - 1);   // possible marker prefix — hold
        const emit = gHold.slice(0, gHold.length - keep);
        if (emit) { if (gInThought) think += emit; else text += emit; }
        gHold = gHold.slice(gHold.length - keep);
        break;
      }
      const before = gHold.slice(0, at);
      if (before) { if (gInThought) think += before; else text += before; }
      gHold = gHold.slice(at + marker.length);
      gInThought = !gInThought;
    }
    return { text: text, think: think };
  }
  // Flush any held-back tail (an unterminated marker prefix, or a thought the model never
  // closed). Returns { text, think } and resets the hold.
  split.flush = function () {
    const out = { text: gInThought ? '' : gHold, think: gInThought ? gHold : '' };
    gHold = '';
    return out;
  };
  return split;
}

module.exports = { SETTINGS_SPEC, readSetting, clamp, safeId, cardId, extractCardFromPng, normalizeCard, sleep, isRetryable, localDateStamp, estTok, redactSettingsText, mergeKeyOnRestore, createGeminiSplit };
