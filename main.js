// Constellation — Electron main process.
// This is the only place that touches the network or your API key.
// The UI (renderer) talks to it through the safe window.api bridge (see preload.js).

const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

// Defensive require: openai v4 exposes the class at .default under CommonJS.
const _openai = require('openai');
const OpenAI = _openai.default || _openai.OpenAI || _openai;

// Writable user data lives in the OS app-data folder — safe inside a packaged .exe and
// survives reinstalls/updates. (app.getPath is available once 'electron' is required.)
const USER_DATA_DIR = app.getPath('userData');
const CONFIG_DIR = path.join(USER_DATA_DIR, 'config');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.txt');
const PHRASE_BANS_FILE = path.join(CONFIG_DIR, 'phrase_bans.txt');   // global phrase-ban/substitution list (multiline)
const MODES_DIR = path.join(CONFIG_DIR, 'modes');
const DATA_DIR = path.join(USER_DATA_DIR, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const PRESETS_DIR = path.join(DATA_DIR, 'presets');
const DRAFTS_FILE = path.join(DATA_DIR, 'drafts.json');
const FOLDERS_FILE = path.join(DATA_DIR, 'folders.json');
const BOOKMARKS_FILE = path.join(DATA_DIR, 'bookmarks.json');
const LOREBOOK_FILE = path.join(DATA_DIR, 'lorebook.json');        // legacy single-lorebook (migrated on first run)
const LOREBOOKS_FILE = path.join(DATA_DIR, 'lorebooks.json');      // collection: { id: { id, name, entries, semantic } }
const WINDOW_STATE_FILE = path.join(USER_DATA_DIR, 'window-state.json');

// Shipped defaults (read-only once packaged) — used to seed user data on first run.
const SOURCE_CONFIG_DIR = path.join(__dirname, 'config');
const SOURCE_DATA_DIR = path.join(__dirname, 'data');

const DEFAULT_SETTINGS = [
  '# Constellation settings — edit values after the colons.',
  'api_key:',
  'model: glm-5.3',
  'base_url: https://api.z.ai/api/coding/paas/v4',
  'temperature: 0.8',
  'top_p: 0.95',
  'max_tokens: 4096',
  'thinking: off',
  '',
].join('\n');

// ---------- Window ----------
function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8')); } catch (e) { return null; }
}
function saveWindowState(state) {
  try { fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state), 'utf8'); } catch (e) {}
}
function createWindow() {
  const saved = loadWindowState() || {};
  const win = new BrowserWindow({
    width: saved.width || 1200,
    height: saved.height || 800,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'Constellation',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Security: the chat must never navigate away or spawn raw Electron windows. External links
  // (http/https) are handed to the user's real browser; everything else is denied.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Remember the window size across launches (skip while maximized, so a normal size is restored).
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isMaximized()) return;
      const b = win.getBounds();
      saveWindowState({ width: b.width, height: b.height });
    }, 500);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);

  // Forward renderer console messages here so UI errors are visible while developing.
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log('[renderer] ' + message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer gone] ' + JSON.stringify(details));
  });

  // Right-click menu: spell-check corrections + add-to-dictionary (and copy/paste) in text fields.
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord && params.dictionarySuggestions && params.dictionarySuggestions.length) {
      for (const sug of params.dictionarySuggestions.slice(0, 6)) {
        items.push(new MenuItem({ label: sug, click: () => win.webContents.replaceMisspelling(sug) }));
      }
      items.push(new MenuItem({ type: 'separator' }));
      items.push(new MenuItem({
        label: 'Add to dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }));
    }
    if (params.editFlags && params.selectionText && params.editFlags.canCopy) {
      items.push(new MenuItem({ label: 'Copy', click: () => win.webContents.copy() }));
    }
    if (params.editFlags && params.editFlags.canPaste) {
      items.push(new MenuItem({ label: 'Paste', click: () => win.webContents.paste() }));
    }
    if (items.length) {
      const menu = new Menu();
      for (const it of items) menu.append(it);
      menu.popup();
    }
  });
}

// ---------- Config (plain "key: value" with # comments) ----------
function parseTxt(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf(':');
    if (idx === -1) continue;
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return out;
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function getSettings() {
  let s = {};
  try { s = parseTxt(SETTINGS_FILE); } catch (e) { /* file missing -> defaults */ }
  return {
    apiKey: s.api_key || process.env.ZAI_API_KEY || '',
    model: s.model || 'glm-5.3',
    baseUrl: s.base_url || 'https://open.bigmodel.cn/api/paas/v4/',
    temperature: parseFloat(s.temperature || '0.8'),
    topP: parseFloat(s.top_p || '0.95'),
    maxTokens: parseInt(s.max_tokens || '0', 10) || 0,
    thinking: /^(on|true|1)$/i.test(s.thinking || ''),
    reasoningEffort: ['max','xhigh','high','medium','low','minimal','none'].includes(s.reasoning_effort) ? s.reasoning_effort : 'max',
    fontScale: clamp(parseFloat(s.font_scale || '1') || 1, 0.8, 1.6),
    chatWidth: clamp(parseInt(s.chat_width || '880', 10) || 880, 600, 1500),
    accent: /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '',
    streamCps: clamp(parseInt(s.stream_cps || '0', 10) || 0, 0, 2000),   // 0 = instant
    starDensity: clamp(parseFloat(s.star_density || '1') || 1, 0.2, 2.5),
    twinkleSpeed: clamp(parseFloat(s.twinkle_speed || '1') || 1, 0, 2.5),   // 0 = frozen
    contextWindow: clamp(parseInt(s.context_window || '0', 10) || 0, 0, 1000000),   // 0 = unlimited
    cliServer: /^(on|true|1)$/i.test(s.cli_server || ''),
    flareIntensity: clamp(parseFloat(s.flare_intensity || '0.5') || 0.5, 0, 1),
    flareRange: clamp(parseInt(s.flare_range || '140', 10) || 140, 50, 400),
    flareSize: clamp(parseInt(s.flare_size || '35', 10) || 35, 20, 100),
    flareBlend: ['screen','soft-light','overlay','normal'].includes(s.flare_blend) ? s.flare_blend : 'screen',
    fxEvents: s.fx_events === undefined ? true : /^(on|true|1)$/i.test(s.fx_events || ''),
    colorWords: s.color_words === undefined ? true : /^(on|true|1)$/i.test(s.color_words || ''),
    moodSky: s.mood_sky === undefined ? true : /^(on|true|1)$/i.test(s.mood_sky || ''),
    fxSize: clamp(parseFloat(s.fx_size || '1') || 1, 0.4, 2.5),
  };
}

// ---------- IPC: config ----------
ipcMain.handle('config:load', () => {
  const s = getSettings();
  return {
    apiKey: s.apiKey,
    model: s.model,
    baseUrl: s.baseUrl,
    temperature: s.temperature,
    topP: s.topP,
    maxTokens: s.maxTokens,
    thinking: s.thinking,
    reasoningEffort: s.reasoningEffort,
    fontScale: s.fontScale,
    chatWidth: s.chatWidth,
    accent: s.accent,
    streamCps: s.streamCps,
    starDensity: s.starDensity,
    twinkleSpeed: s.twinkleSpeed,
    contextWindow: s.contextWindow,
    cliServer: s.cliServer,
    flareIntensity: s.flareIntensity, flareRange: s.flareRange, flareSize: s.flareSize, flareBlend: s.flareBlend,
    fxEvents: s.fxEvents, fxSize: s.fxSize,
    phraseBans: readTextSafe(PHRASE_BANS_FILE) || '',
    hasKey: !!s.apiKey,
  };
});

ipcMain.handle('config:save', (_e, patch) => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  let lines = [];
  try { lines = fs.readFileSync(SETTINGS_FILE, 'utf8').split(/\r?\n/); } catch (e) {}

  const setLine = (key, val) => {
    let found = false;
    lines = lines.map((l) => {
      const t = l.trim();
      if (!t.startsWith('#') && t.toLowerCase().startsWith(key.toLowerCase() + ':')) {
        found = true;
        return `${key}: ${val}`;
      }
      return l;
    });
    if (!found) lines.push(`${key}: ${val}`);
  };
  if (patch.api_key !== undefined) setLine('api_key', patch.api_key);
  if (patch.model !== undefined) setLine('model', patch.model);
  if (patch.base_url !== undefined) setLine('base_url', patch.base_url);
  if (patch.temperature !== undefined) setLine('temperature', patch.temperature);
  if (patch.top_p !== undefined) setLine('top_p', patch.top_p);
  if (patch.max_tokens !== undefined) setLine('max_tokens', patch.max_tokens);
  if (patch.thinking !== undefined) setLine('thinking', patch.thinking ? 'on' : 'off');
  if (patch.reasoning_effort !== undefined) setLine('reasoning_effort', patch.reasoning_effort);
  if (patch.font_scale !== undefined) setLine('font_scale', patch.font_scale);
  if (patch.chat_width !== undefined) setLine('chat_width', patch.chat_width);
  if (patch.accent !== undefined) setLine('accent', patch.accent);
  if (patch.stream_cps !== undefined) setLine('stream_cps', patch.stream_cps);
  if (patch.star_density !== undefined) setLine('star_density', patch.star_density);
  if (patch.twinkle_speed !== undefined) setLine('twinkle_speed', patch.twinkle_speed);
  if (patch.context_window !== undefined) setLine('context_window', patch.context_window);
  if (patch.cli_server !== undefined) setLine('cli_server', patch.cli_server);
  if (patch.flare_intensity !== undefined) setLine('flare_intensity', patch.flare_intensity);
  if (patch.flare_range !== undefined) setLine('flare_range', patch.flare_range);
  if (patch.flare_size !== undefined) setLine('flare_size', patch.flare_size);
  if (patch.flare_blend !== undefined) setLine('flare_blend', patch.flare_blend);
  if (patch.fx_events !== undefined) setLine('fx_events', patch.fx_events);
  if (patch.color_words !== undefined) setLine('color_words', patch.color_words);
  if (patch.mood_sky !== undefined) setLine('mood_sky', patch.mood_sky);
  if (patch.fx_size !== undefined) setLine('fx_size', patch.fx_size);
  fs.writeFileSync(SETTINGS_FILE, lines.join('\n'), 'utf8');
  return getSettings();
});

// ---------- IPC: mode prompts ----------
ipcMain.handle('phrasebans:save', (_e, text) => {
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.writeFileSync(PHRASE_BANS_FILE, String(text || ''), 'utf8'); return { ok: true }; }
  catch (e) { return { ok: false }; }
});

ipcMain.handle('modes:load', () => {
  const modes = {};
  try {
    for (const f of fs.readdirSync(MODES_DIR)) {
      if (f.endsWith('.txt')) {
        modes[path.basename(f, '.txt')] = fs.readFileSync(path.join(MODES_DIR, f), 'utf8');
      }
    }
  } catch (e) { /* modes dir missing */ }
  return modes;
});

ipcMain.handle('modes:save', (_e, name, content) => {
  fs.mkdirSync(MODES_DIR, { recursive: true });
  const safe = path.basename(String(name));
  fs.writeFileSync(path.join(MODES_DIR, safe + '.txt'), content || '', 'utf8');
  return { ok: true };
});

ipcMain.handle('project:load', () => {
  try { return fs.readFileSync(path.join(CONFIG_DIR, 'project.txt'), 'utf8'); }
  catch (e) { return ''; }
});

ipcMain.handle('project:save', (_e, content) => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, 'project.txt'), content || '', 'utf8');
  return { ok: true };
});

// ---------- IPC: sessions (saved chats) ----------
// ---------- IPC hardening ----------
// Every handler that touches a file by a renderer-supplied id validates it here: plain word
// characters only (no dots/slashes), which blocks path traversal ("../../") if the renderer is
// ever compromised. Defense in depth behind contextIsolation + the markdown sanitizer + CSP.
function safeId(id) {
  return (typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)) ? id : null;
}

ipcMain.handle('sessions:list', () => {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const list = fs.readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
          return { id: d.id || f.replace(/\.json$/, ''), title: d.title || 'Untitled', updatedAt: d.updatedAt || 0, pinned: !!d.pinned, hidden: !!d.hidden, usage: d.usage || { tokens: 0, requests: 0 }, parentId: d.parentId, parentTitle: d.parentTitle, folder: d.folder || null };
        } catch (e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if ((!!a.pinned) !== (!!b.pinned)) return a.pinned ? -1 : 1;   // pinned chats first
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    return list;
  } catch (e) { return []; }
});

ipcMain.handle('sessions:load', (_e, id) => {
  if (!safeId(id)) return { id: null, title: 'Untitled', messages: [] };
  try {
    const d = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, id + '.json'), 'utf8'));
    return { id: d.id, title: d.title, messages: d.messages || [], system: d.system, project: d.project, systemFiles: d.systemFiles || [], projectFiles: d.projectFiles || [], gen: d.gen, usage: d.usage, parentId: d.parentId, parentTitle: d.parentTitle, lore: Array.isArray(d.lore) ? d.lore : [] };
  } catch (e) { return { id, title: 'Untitled', messages: [] }; }
});

ipcMain.handle('sessions:save', (_e, { id, title, messages, system, project, gen, usage, parentId, parentTitle, systemFiles, projectFiles, lore }) => {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  id = safeId(id) || 's_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);   // invalid/absent id → fresh one, never trusted
  const file = path.join(SESSIONS_DIR, id + '.json');
  let pinned = false, pId, pTitle, folder = null, pLore = null, wasHidden = false;
  try { const ex = JSON.parse(fs.readFileSync(file, 'utf8')); pinned = !!ex.pinned; pId = ex.parentId; pTitle = ex.parentTitle; folder = ex.folder || null; pLore = Array.isArray(ex.lore) ? ex.lore : null; wasHidden = !!ex.hidden; } catch (e) {}
  const data = {
    id, title: title || 'Untitled', messages: messages || [], system, project, systemFiles: systemFiles || [], projectFiles: projectFiles || [], gen, usage, pinned, hidden: wasHidden,
    parentId: parentId !== undefined ? parentId : pId, parentTitle: parentTitle !== undefined ? parentTitle : pTitle,
    folder, lore: Array.isArray(lore) ? lore : (pLore || []),
    updatedAt: Date.now(),
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return { id };
});

ipcMain.handle('sessions:delete', (_e, id) => {
  if (!safeId(id)) return { ok: false };
  try { fs.unlinkSync(path.join(SESSIONS_DIR, id + '.json')); } catch (e) {}
  try {   // a deleted chat's bookmarks are now orphans — drop them
    const bms = readBookmarks();
    const next = bms.filter((b) => b.chatId !== id);
    if (next.length !== bms.length) writeBookmarks(next);
  } catch (e) {}
  return { ok: true };
});

ipcMain.handle('sessions:rename', (_e, { id, title }) => {
  if (!safeId(id)) return { ok: false };
  try {
    const file = path.join(SESSIONS_DIR, id + '.json');
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    d.title = (String(title || '').trim().slice(0, 80)) || 'Untitled';
    fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

ipcMain.handle('sessions:setHidden', (_e, { id, hidden }) => {
  if (!safeId(id)) return { ok: false };
  try {
    const file = path.join(SESSIONS_DIR, id + '.json');
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (hidden) d.hidden = true; else delete d.hidden;
    fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

ipcMain.handle('sessions:setPinned', (_e, { id, pinned }) => {
  if (!safeId(id)) return { ok: false };
  try {
    const file = path.join(SESSIONS_DIR, id + '.json');
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    d.pinned = !!pinned;
    fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

ipcMain.handle('sessions:setFolder', (_e, { id, folder }) => {
  if (!safeId(id)) return { ok: false };
  try {
    const file = path.join(SESSIONS_DIR, id + '.json');
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    d.folder = (folder != null && safeId(folder)) ? folder : null;
    fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

// Which lorebooks a chat has enabled (per-chat lorebook selection). Empty = lore off for that chat.
ipcMain.handle('sessions:setLore', (_e, { id, lore }) => {
  if (!safeId(id)) return { ok: false };
  try {
    const file = path.join(SESSIONS_DIR, id + '.json');
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    d.lore = (Array.isArray(lore) ? lore : []).filter((x) => safeId(x));   // only valid lorebook ids
    fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

// ---------- IPC: folders ----------
ipcMain.handle('folders:load', () => {
  try { return JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')) || {}; } catch (e) { return {}; }
});
ipcMain.handle('folders:save', (_e, { id, name }) => {
  try {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')) || {}; } catch (e) {}
    id = safeId(id) || 'f_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
    d[id] = { id, name: (name || 'Folder').trim().slice(0, 60), collapsed: d[id] ? !!d[id].collapsed : false };
    fs.writeFileSync(FOLDERS_FILE, JSON.stringify(d, null, 2), 'utf8');
    return { id };
  } catch (e) { return { id: null }; }
});
ipcMain.handle('folders:delete', (_e, { id }) => {
  if (!safeId(id)) return { ok: false };
  try {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')) || {}; } catch (e) {}
    delete d[id];
    fs.writeFileSync(FOLDERS_FILE, JSON.stringify(d, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});
ipcMain.handle('folders:toggle', (_e, { id, collapsed }) => {
  if (!safeId(id)) return { ok: false };
  try {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')) || {}; } catch (e) {}
    if (d[id]) { d[id].collapsed = !!collapsed; fs.writeFileSync(FOLDERS_FILE, JSON.stringify(d, null, 2), 'utf8'); }
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

// Full-text search across all saved chats (title + message content). Returns matches with a snippet.
ipcMain.handle('sessions:search', (_e, q) => {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return [];
  try {
    const out = [];
    for (const f of fs.readdirSync(SESSIONS_DIR).filter((x) => x.endsWith('.json'))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
        const title = d.title || 'Untitled';
        let snippet = '', idx = -1;
        if (title.toLowerCase().includes(query)) { snippet = title; idx = 0; }
        else {
          for (let i = 0; i < (d.messages || []).length; i++) {
            const c = String(d.messages[i].content || '');
            const at = c.toLowerCase().indexOf(query);
            if (at !== -1) { idx = i; snippet = c.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, ' ').trim(); break; }
          }
        }
        if (idx !== -1) out.push({ id: d.id || f.replace(/\.json$/, ''), title, snippet, updatedAt: d.updatedAt || 0 });
      } catch (e) {}
    }
    out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return out;
  } catch (e) { return []; }
});

// ---------- IPC: bookmarks (starred messages across all chats) ----------
// Stored as one flat list so the Bookmarks overlay can show favourites from every chat at once.
function readBookmarks() {
  try { return JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf8')) || []; } catch (e) { return []; }
}
function writeBookmarks(list) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(list, null, 2), 'utf8'); } catch (e) {}
}
ipcMain.handle('bookmarks:load', () => readBookmarks());
ipcMain.handle('bookmarks:add', (_e, { chatId, chatTitle, msgIndex, head, role }) => {
  if (!safeId(chatId)) return null;   // bookmarks only attach to real chats
  const list = readBookmarks().filter((b) => !(b.chatId === chatId && b.msgIndex === msgIndex));   // one per chat+message
  const entry = {
    id: 'b_' + Date.now() + '_' + Math.floor(Math.random() * 1e9),
    chatId, chatTitle: chatTitle || 'Untitled',
    msgIndex: Number(msgIndex) || 0, head: String(head || '').slice(0, 160), role: role || 'assistant',
    ts: Date.now(),
  };
  list.push(entry);
  writeBookmarks(list);
  return entry;
});
ipcMain.handle('bookmarks:remove', (_e, { id }) => {
  if (!safeId(id)) return { ok: false };
  writeBookmarks(readBookmarks().filter((b) => b.id !== id));
  return { ok: true };
});

// ---------- IPC: lorebook (keyword-triggered world context) ----------
// Lorebook collection: many titled lorebooks, each enabled per-chat. Stored as one map file.
function readLorebooks() {
  try { const d = JSON.parse(fs.readFileSync(LOREBOOKS_FILE, 'utf8')); return (d && typeof d === 'object') ? d : {}; }
  catch (e) { return {}; }
}
function writeLorebooks(map) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(LOREBOOKS_FILE, JSON.stringify(map || {}, null, 2), 'utf8'); } catch (e) {}
}
// One-time migration: fold the legacy single lorebook into the collection as "Main".
function migrateLorebook() {
  try {
    if (fs.existsSync(LOREBOOKS_FILE)) return;
    const raw = (() => { try { return JSON.parse(fs.readFileSync(LOREBOOK_FILE, 'utf8')); } catch (e) { return null; } })();
    if (!raw) return;
    const id = 'lb_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
    writeLorebooks({ [id]: { id, name: 'Main', semantic: raw.semantic === true, entries: Array.isArray(raw.entries) ? raw.entries : [] } });
  } catch (e) {}
}
ipcMain.handle('lorebooks:load', () => readLorebooks());
ipcMain.handle('lorebooks:save', (_e, map) => { writeLorebooks(map); return readLorebooks(); });

// ---------- IPC: local embeddings (semantic lorebook retrieval) ----------
// Lazy + resilient: the model and ONNX runtime only spin up on first use, so app startup is
// unaffected and BM25 keeps carrying retrieval if this ever fails. The model id is a constant —
// swap it (or the dtype) to adopt a newer/better embedder without touching anything else.
const EMBED_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const EMBED_DIM = 256;   // Matryoshka-truncate the 768-dim vector (≈ same quality, 3× smaller storage)
let _extractorPromise = null;
function getExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline, env } = require('@huggingface/transformers');
      env.cacheDir = path.join(USER_DATA_DIR, 'transformers-cache');
      env.allowLocalModels = false;   // always fetch from the Hub (we don't bundle a local model)
      return pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' });
    })();
    _extractorPromise.catch(() => { _extractorPromise = null; });   // allow a retry after a failure
  }
  return _extractorPromise;
}
function truncateEmbedding(v) {   // Matryoshka: keep the first EMBED_DIM dims, then renormalize
  const a = (Array.isArray(v) ? v : []).slice(0, EMBED_DIM);
  let n = 0; for (const x of a) n += x * x; n = Math.sqrt(n) || 1;
  return a.map((x) => x / n);
}

// ---------- Chronicle: a reader's reference of durable story facts, per chat ----------
const CHRONICLE_FILE = path.join(DATA_DIR, 'chronicle.json');   // { chatId: [ "fact", ... ] }
function readChronicle() {
  try { return JSON.parse(fs.readFileSync(CHRONICLE_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
ipcMain.handle('chronicle:load', (_e, id) => {
  if (!safeId(id)) return [];
  const all = readChronicle();
  return Array.isArray(all[id]) ? all[id] : [];
});
ipcMain.handle('chronicle:save', (_e, { id, facts }) => {
  if (!safeId(id)) return { ok: false };
  const all = readChronicle();
  all[id] = (Array.isArray(facts) ? facts : []).filter((f) => typeof f === 'string').slice(0, 400).map((f) => f.slice(0, 400));
  if (!all[id].length) delete all[id];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CHRONICLE_FILE, JSON.stringify(all, null, 2), 'utf8');
  return { ok: true };
});
// Distill durable facts from a conversation with flash. Extraction, not summary — the model
// records WHAT happened as terse facts; intimate scenes become plain plot beats. If the model
// refuses or nothing durable happened, we return an empty list and the panel simply stays as-is.
ipcMain.handle('chronicle:extract', async (_e, { messages }) => {
  const s = getSettings();
  if (!s.apiKey) throw new Error('No API key set.');
  const convo = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.role !== 'system' && (m.content || '').trim())
    .slice(-200)
    .map((m) => (m.role === 'user' ? 'USER: ' : 'STORY: ') + String(m.content).replace(/\s+/g, ' ').slice(0, 2200))
    .join('\n\n');
  const client = new OpenAI({ apiKey: s.apiKey, baseURL: s.baseUrl, maxRetries: 1 });
  const r = await client.chat.completions.create({
    model: 'glm-5.3-flash',
    messages: [
      { role: 'system', content: 'You maintain a story chronicle for a writer — a quick reference so they never misremember their own story. Extract ONLY durable story facts as terse one-line bullets: character traits and relationships, secrets revealed, promises and debts, injuries or status changes, locations and travel, goals, major events, unresolved tensions. Do NOT retell or summarize scenes — this is a factual index, not a retelling. Pronouns become names. No preamble, no commentary: bullets only, each starting with "- ". If nothing durable happened, reply with exactly: NONE.' },
      { role: 'user', content: convo || '(empty story)' },
    ],
    max_tokens: 12288,   // flash thinks heavily — a small budget comes back empty after reasoning eats it
    temperature: 0.3,
    thinking: { type: 'enabled' },
  });
  const text = ((r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '').trim();
  if (!text || /^none$/i.test(text)) return [];
  return text.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').replace(/^\s*#{1,4}\s*/, '').replace(/\*\*/g, '').trim()).filter((l) => l && !/^none$/i.test(l)).slice(0, 60);
});

ipcMain.handle('lore:embed', async (_e, { texts, query }) => {
  if (!(texts && texts.length)) return [];
  try {
    const extractor = await getExtractor();
    const prefix = query ? 'search_query: ' : 'search_document: ';   // nomic distinguishes corpus vs query
    const docs = texts.map((t) => prefix + String(t || ''));
    const output = await extractor(docs, { pooling: 'mean', normalize: true });
    let vecs;
    if (typeof output.tolist === 'function') vecs = output.tolist();
    else {   // fallback: reconstruct from the flat tensor data + last dim
      const data = output.data, d = output.dims[output.dims.length - 1];
      vecs = []; for (let i = 0; i < data.length; i += d) vecs.push(Array.from(data.slice(i, i + d)));
    }
    return vecs.map(truncateEmbedding);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
});

// Per-chat draft autosave (a single map of sessionId -> draft text).
ipcMain.handle('drafts:load', () => {
  try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')) || {}; } catch (e) { return {}; }
});
ipcMain.handle('drafts:save', (_e, { id, text }) => {
  try {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')) || {}; } catch (e) {}
    if (text) d[id] = text; else delete d[id];
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(d, null, 2), 'utf8');
  } catch (e) {}
  return { ok: true };
});

// ---------- IPC: presets (saved system + project prompt sets) ----------
ipcMain.handle('presets:list', () => {
  try {
    fs.mkdirSync(PRESETS_DIR, { recursive: true });
    const list = fs.readdirSync(PRESETS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, f), 'utf8'));
          return { id: d.id || f.replace(/\.json$/, ''), name: d.name || 'Untitled' };
        } catch (e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
  } catch (e) { return []; }
});

ipcMain.handle('presets:load', (_e, id) => {
  if (!safeId(id)) return { id: null, name: 'Untitled', system: '', project: '' };
  try {
    const d = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, id + '.json'), 'utf8'));
    return { id: d.id, name: d.name, system: d.system || '', project: d.project || '' };
  } catch (e) { return { id, name: 'Untitled', system: '', project: '' }; }
});

ipcMain.handle('presets:save', (_e, { id, name, system, project }) => {
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
  id = safeId(id) || 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
  const data = { id, name: name || 'Untitled', system: system || '', project: project || '' };
  fs.writeFileSync(path.join(PRESETS_DIR, id + '.json'), JSON.stringify(data, null, 2), 'utf8');
  return { id };
});

ipcMain.handle('presets:delete', (_e, id) => {
  if (!safeId(id)) return { ok: false };
  try { fs.unlinkSync(path.join(PRESETS_DIR, id + '.json')); } catch (e) {}
  return { ok: true };
});

// ---------- IPC: craft journal ----------
ipcMain.handle('craft:journal:load', () => {
  try { return fs.readFileSync(path.join(DATA_DIR, 'craft_journal.txt'), 'utf8'); }
  catch (e) { return ''; }
});

ipcMain.handle('craft:journal:append', (_e, line) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(path.join(DATA_DIR, 'craft_journal.txt'), '- ' + String(line || '') + '\n', 'utf8');
  return { ok: true };
});

// ---------- IPC: export current chat to a Markdown/text file ----------
ipcMain.handle('export:markdown', async (_e, { defaultName, content }) => {
  try {
    const safeName = (String(defaultName || 'chat').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60)) || 'chat';
    const res = await dialog.showSaveDialog({
      title: 'Export chat',
      defaultPath: safeName + '.md',
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, String(content || ''), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ---------- IPC: clipboard ----------
// Main-process clipboard write is reliable for large payloads; navigator.clipboard.writeText is
// async (returns a Promise) and silently rejects on big text, so the renderer routes copies here.
ipcMain.handle('clipboard:write', (_e, text) => {
  try { clipboard.writeText(String(text || '')); return true; } catch (e) { return false; }
});

// ---------- IPC: backup / restore ----------
function readTextSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function readJsonDir(dir) {
  const out = {};
  try { for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.json')) continue; try { out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) {} } } catch (e) {}
  return out;
}
function clearJsonDir(dir) {
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} } } catch (e) {}
}

ipcMain.handle('backup:export', async () => {
  try {
    const bundle = {
      app: 'constellation', version: 1, exportedAt: Date.now(),
      config: {
        settings: readTextSafe(path.join(CONFIG_DIR, 'settings.txt')),
        project: readTextSafe(path.join(CONFIG_DIR, 'project.txt')),
        modes: {
          roleplay: readTextSafe(path.join(MODES_DIR, 'roleplay.txt')),
          creative: readTextSafe(path.join(MODES_DIR, 'creative.txt')),
          craft: readTextSafe(path.join(MODES_DIR, 'craft.txt')),
        },
        phraseBans: readTextSafe(PHRASE_BANS_FILE),
      },
      sessions: readJsonDir(SESSIONS_DIR),
      presets: readJsonDir(PRESETS_DIR),
      drafts: (() => { try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')); } catch (e) { return {}; } })(),
      folders: (() => { try { return JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')) || {}; } catch (e) { return {}; } })(),
      lorebooks: readLorebooks(),
      craftJournal: readTextSafe(path.join(DATA_DIR, 'craft_journal.txt')),
    };
    const res = await dialog.showSaveDialog({
      title: 'Backup Constellation data',
      defaultPath: 'constellation-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, JSON.stringify(bundle, null, 2), 'utf8');
    return { ok: true, path: res.filePath, sessions: Object.keys(bundle.sessions).length };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('backup:import', async () => {
  try {
    const open = await dialog.showOpenDialog({
      title: 'Restore Constellation data', properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (open.canceled || !open.filePaths || !open.filePaths[0]) return { ok: false, canceled: true };
    const bundle = JSON.parse(fs.readFileSync(open.filePaths[0], 'utf8'));
    if (!bundle || bundle.app !== 'constellation') return { ok: false, error: 'Not a Constellation backup file.' };
    const confirm = await dialog.showMessageBox({
      type: 'warning', buttons: ['Restore', 'Cancel'], defaultId: 1, title: 'Restore backup',
      message: 'Restore this backup?',
      detail: 'This OVERWRITES your current chats, settings, prompts, and craft journal with the backup. Existing chats not in the backup will be removed. This cannot be undone.',
    });
    if (confirm.response !== 0) return { ok: false, canceled: true };
    fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.mkdirSync(MODES_DIR, { recursive: true });
    if (bundle.config) {
      if (bundle.config.settings != null) fs.writeFileSync(path.join(CONFIG_DIR, 'settings.txt'), bundle.config.settings, 'utf8');
      if (bundle.config.project != null) fs.writeFileSync(path.join(CONFIG_DIR, 'project.txt'), bundle.config.project, 'utf8');
      if (bundle.config.modes) for (const k of ['roleplay', 'creative', 'craft']) if (bundle.config.modes[k] != null) fs.writeFileSync(path.join(MODES_DIR, k + '.txt'), bundle.config.modes[k], 'utf8');
      if (bundle.config.phraseBans != null) fs.writeFileSync(PHRASE_BANS_FILE, bundle.config.phraseBans, 'utf8');
    }
    fs.mkdirSync(SESSIONS_DIR, { recursive: true }); clearJsonDir(SESSIONS_DIR);
    if (bundle.sessions) for (const [sid, data] of Object.entries(bundle.sessions)) { if (!safeId(sid)) continue; fs.writeFileSync(path.join(SESSIONS_DIR, sid + '.json'), JSON.stringify(data, null, 2), 'utf8'); }
    fs.mkdirSync(PRESETS_DIR, { recursive: true }); clearJsonDir(PRESETS_DIR);
    if (bundle.presets) for (const [pid, data] of Object.entries(bundle.presets)) { if (!safeId(pid)) continue; fs.writeFileSync(path.join(PRESETS_DIR, pid + '.json'), JSON.stringify(data, null, 2), 'utf8'); }
    if (bundle.drafts) fs.writeFileSync(DRAFTS_FILE, JSON.stringify(bundle.drafts, null, 2), 'utf8');
    if (bundle.folders) fs.writeFileSync(FOLDERS_FILE, JSON.stringify(bundle.folders, null, 2), 'utf8');
    if (bundle.lorebooks) writeLorebooks(bundle.lorebooks);
    if (bundle.craftJournal != null) fs.writeFileSync(path.join(DATA_DIR, 'craft_journal.txt'), bundle.craftJournal, 'utf8');
    return { ok: true, sessions: bundle.sessions ? Object.keys(bundle.sessions).length : 0 };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

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

// ---------- IPC: streaming chat ----------
const activeStreams = new Map();   // requestId -> AbortController, so the UI can Stop a stream

ipcMain.handle('chat:stream', async (event, payload) => {
  const { messages, opts = {}, requestId } = payload;
  const ac = new AbortController();
  activeStreams.set(requestId, ac);
  const isAbort = (err) => err && (err.name === 'AbortError' || /abort/i.test(err.message || ''));
  try {
    const s = getSettings();
    if (!s.apiKey) throw new Error('No API key set. Add your GLM key in Settings (or config/settings.txt).');
    const client = new OpenAI({ apiKey: s.apiKey, baseURL: s.baseUrl, maxRetries: 0 });
    const supportsEffort = /^glm-5\.[2-9]/i.test(String(opts.model || s.model));   // reasoning_effort is GLM-5.2+
    const isGlmEndpoint = /z\.ai|bigmodel/i.test(String(s.baseUrl || ''));   // GLM-specific params (thinking) only go to GLM

    // Retry the initial request on transient failures (rate limits, network blips),
    // but give up immediately on billing errors (e.g. out-of-credits 429).
    const MAX_ATTEMPTS = 4;
    let stream;
    let aborted = false;
    for (let attempt = 1; ; attempt++) {
      try {
        stream = await client.chat.completions.create({
          model: opts.model || s.model,
          messages,
          temperature: opts.temperature ?? s.temperature,
          top_p: opts.topP ?? s.topP,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.thinking && isGlmEndpoint ? {
              thinking: { type: 'enabled', clear_thinking: false },   // clear_thinking:false = Preserved Thinking
              ...(supportsEffort && opts.reasoningEffort && opts.reasoningEffort !== 'max'
                ? { reasoning_effort: opts.reasoningEffort } : {}),
            } : {}),
          // Non-GLM providers (OpenRouter & friends): pass the standard OpenAI-style effort knob,
          // mapped from our options. 'none' means don't send it.
          ...(opts.thinking && !isGlmEndpoint && opts.reasoningEffort && opts.reasoningEffort !== 'none'
            ? { reasoning_effort: ({ max: 'high', xhigh: 'high', high: 'high', medium: 'medium', low: 'low', minimal: 'minimal' })[opts.reasoningEffort] || 'high' }
            : {}),
          stream: true,
        }, { signal: ac.signal });
        break;
      } catch (err) {
        if (isAbort(err)) { aborted = true; break; }   // user hit Stop
        if (attempt < MAX_ATTEMPTS && isRetryable(err)) {
          event.sender.send('chat:retry', { requestId, attempt: attempt + 1 });
          await sleep(Math.min(8000, 800 * Math.pow(2, attempt - 1)));
          continue;
        }
        throw err;   // bubble up -> friendly chat:error
      }
    }

    let full = '';
    let finishReason = null;
    if (!aborted) {
      try {
        for await (const chunk of stream) {
          const choice = chunk.choices && chunk.choices[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;   // 'length' = cut off by max_tokens
          const delta = choice.delta || {};
          const think = delta.reasoning_content || '';
          const piece = delta.content || '';
          if (think) event.sender.send('chat:chunk', { requestId, delta: think, kind: 'think' });
          if (piece) {
            full += piece;
            event.sender.send('chat:chunk', { requestId, delta: piece, kind: 'text' });
          }
        }
      } catch (err) {
        if (!isAbort(err)) throw err;   // a real mid-stream error -> chat:error; an abort just ends it
      }
    }
    event.sender.send('chat:done', { requestId, full, finishReason });   // finishReason lets the UI offer "Continue"
    return { ok: true };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    event.sender.send('chat:error', { requestId, message });
    return { ok: false, message };
  } finally {
    activeStreams.delete(requestId);
  }
});

// Stop an in-flight stream; whatever was already generated is kept (chat:done fires with the partial).
ipcMain.handle('chat:cancel', (_e, { requestId }) => {
  const ac = activeStreams.get(requestId);
  if (ac) { try { ac.abort(); } catch (e) {} }
  return { ok: true };
});

// ---------- Lifecycle ----------
// Copy shipped defaults into the writable user-data folder (only files not already there),
// so a fresh install gets the starter prompts and a dev install carries over existing data.
function copyTreeIfMissing(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTreeIfMissing(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

function estTok(s) { return Math.round((String(s || '').length) / 4); }
// One-time backfill: give older chats (saved before usage tracking) an estimated historical token
// count reconstructed from their message history. Idempotent — skips chats that already have `usage`.
function backfillUsage() {
  try {
    for (const f of fs.readdirSync(SESSIONS_DIR).filter((x) => x.endsWith('.json'))) {
      try {
        const file = path.join(SESSIONS_DIR, f);
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (d.usage) continue;
        const msgs = d.messages || [];
        let tokens = 0, requests = 0, acc = estTok(d.system || '');
        for (const m of msgs) {
          acc += estTok(m.content);
          if (m.role === 'assistant') { tokens += acc; requests++; }   // context accumulated up to this reply
        }
        d.usage = { tokens, requests };
        fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
      } catch (e) {}
    }
  } catch (e) {}
}

// ---------- Local CLI server (Shape A) — localhost-only, token-protected, off by default ----------
// Lets the assistant drive the running app over HTTP for testing. Security: bound to 127.0.0.1 only,
// a per-launch random token (written to userData/cli-server.json), the Host header must be localhost,
// and it only starts when cli_server is on. Commands are read-only / non-destructive (dry-send runs a
// real GLM call but never persists anything).
let cliServer = null;
const cliPending = new Map();
let cliSeq = 0;
ipcMain.on('cli:res', (_e, payload) => {
  const p = cliPending.get(payload.id);
  if (p) { cliPending.delete(payload.id); clearTimeout(p.timer); p.resolve(payload.res); }
});
function rendererCmd(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return reject(new Error('no window'));
    const id = 'c' + (++cliSeq);
    const timer = setTimeout(() => { cliPending.delete(id); reject(new Error('timeout')); }, timeoutMs || 30000);
    cliPending.set(id, { resolve, timer });
    win.webContents.send('cli:req', { id, cmd, args });
  });
}
async function handleCliHttp(req, res, token) {
  try {
    const host = String(req.headers.host || '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(403); return res.end('forbidden'); }   // anti DNS-rebinding
    if ((req.headers.authorization || '') !== 'Bearer ' + token) { res.writeHead(401); return res.end('unauthorized'); }
    const u = new URL(req.url, 'http://127.0.0.1');
    const cmd = { '/ping': 'ping', '/state': 'state', '/retrieve': 'retrieve', '/bans': 'bans', '/dry-send': 'dry-send' }[u.pathname];
    if (!cmd) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'unknown route: ' + u.pathname })); }
    let args = {};
    if (req.method === 'GET') u.searchParams.forEach((v, k) => { args[k] = v; });
    else { const body = await new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); }); try { args = JSON.parse(body || '{}'); } catch (e) {} }
    const result = await rendererCmd(cmd, args, cmd === 'dry-send' ? 180000 : 30000);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}
function startCliServer() {
  if (cliServer) return;
  if (!getSettings().cliServer) return;   // off by default
  const PORT = 7331;
  const token = crypto.randomBytes(16).toString('hex');
  cliServer = http.createServer((req, res) => handleCliHttp(req, res, token));
  cliServer.on('error', () => { cliServer = null; });
  cliServer.listen(PORT, '127.0.0.1', () => {
    try { fs.writeFileSync(path.join(USER_DATA_DIR, 'cli-server.json'), JSON.stringify({ port: PORT, token, enabled: true }), 'utf8'); } catch (e) {}
  });
}

app.whenReady().then(() => {
  copyTreeIfMissing(SOURCE_CONFIG_DIR, CONFIG_DIR);
  copyTreeIfMissing(SOURCE_DATA_DIR, DATA_DIR);
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, DEFAULT_SETTINGS, 'utf8');
  }
  backfillUsage();
  migrateLorebook();
  createWindow();
  startCliServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
