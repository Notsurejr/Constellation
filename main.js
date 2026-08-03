// Constellation — Electron main process.
// This is the only place that touches the network or your API key.
// The UI (renderer) talks to it through the safe window.api bridge (see preload.js).

const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');

// Defensive require: openai v4 exposes the class at .default under CommonJS.
const _openai = require('openai');
const OpenAI = _openai.default || _openai.OpenAI || _openai;

// Writable user data lives in the OS app-data folder — safe inside a packaged .exe and
// survives reinstalls/updates. (app.getPath is available once 'electron' is required.)
const USER_DATA_DIR = app.getPath('userData');
const CONFIG_DIR = path.join(USER_DATA_DIR, 'config');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.txt');
const MODES_DIR = path.join(CONFIG_DIR, 'modes');
const DATA_DIR = path.join(USER_DATA_DIR, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const PRESETS_DIR = path.join(DATA_DIR, 'presets');
const DRAFTS_FILE = path.join(DATA_DIR, 'drafts.json');
const WINDOW_STATE_FILE = path.join(USER_DATA_DIR, 'window-state.json');

// Shipped defaults (read-only once packaged) — used to seed user data on first run.
const SOURCE_CONFIG_DIR = path.join(__dirname, 'config');
const SOURCE_DATA_DIR = path.join(__dirname, 'data');

const DEFAULT_SETTINGS = [
  '# Constellation settings — edit values after the colons.',
  'api_key:',
  'model: glm-5.2',
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
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

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
    model: s.model || 'glm-5.2',
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
  fs.writeFileSync(SETTINGS_FILE, lines.join('\n'), 'utf8');
  return getSettings();
});

// ---------- IPC: mode prompts ----------
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
ipcMain.handle('sessions:list', () => {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const list = fs.readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
          return { id: d.id || f.replace(/\.json$/, ''), title: d.title || 'Untitled', updatedAt: d.updatedAt || 0, pinned: !!d.pinned, usage: d.usage || { tokens: 0, requests: 0 }, parentId: d.parentId, parentTitle: d.parentTitle };
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
  try {
    const d = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, id + '.json'), 'utf8'));
    return { id: d.id, title: d.title, messages: d.messages || [], system: d.system, project: d.project, gen: d.gen, usage: d.usage, parentId: d.parentId, parentTitle: d.parentTitle };
  } catch (e) { return { id, title: 'Untitled', messages: [] }; }
});

ipcMain.handle('sessions:save', (_e, { id, title, messages, system, project, gen, usage, parentId, parentTitle }) => {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  if (!id) id = 's_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
  const file = path.join(SESSIONS_DIR, id + '.json');
  let pinned = false, pId, pTitle;
  try { const ex = JSON.parse(fs.readFileSync(file, 'utf8')); pinned = !!ex.pinned; pId = ex.parentId; pTitle = ex.parentTitle; } catch (e) {}
  const data = {
    id, title: title || 'Untitled', messages: messages || [], system, project, gen, usage, pinned,
    parentId: parentId !== undefined ? parentId : pId, parentTitle: parentTitle !== undefined ? parentTitle : pTitle,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return { id };
});

ipcMain.handle('sessions:delete', (_e, id) => {
  try { fs.unlinkSync(path.join(SESSIONS_DIR, id + '.json')); } catch (e) {}
  return { ok: true };
});

ipcMain.handle('sessions:rename', (_e, { id, title }) => {
  try {
    const file = path.join(SESSIONS_DIR, id + '.json');
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    d.title = (String(title || '').trim().slice(0, 80)) || 'Untitled';
    fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

ipcMain.handle('sessions:setPinned', (_e, { id, pinned }) => {
  try {
    const file = path.join(SESSIONS_DIR, id + '.json');
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    d.pinned = !!pinned;
    fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
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
  try {
    const d = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, id + '.json'), 'utf8'));
    return { id: d.id, name: d.name, system: d.system || '', project: d.project || '' };
  } catch (e) { return { id, name: 'Untitled', system: '', project: '' }; }
});

ipcMain.handle('presets:save', (_e, { id, name, system, project }) => {
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
  if (!id) id = 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
  const data = { id, name: name || 'Untitled', system: system || '', project: project || '' };
  fs.writeFileSync(path.join(PRESETS_DIR, id + '.json'), JSON.stringify(data, null, 2), 'utf8');
  return { id };
});

ipcMain.handle('presets:delete', (_e, id) => {
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
      },
      sessions: readJsonDir(SESSIONS_DIR),
      presets: readJsonDir(PRESETS_DIR),
      drafts: (() => { try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')); } catch (e) { return {}; } })(),
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
    }
    fs.mkdirSync(SESSIONS_DIR, { recursive: true }); clearJsonDir(SESSIONS_DIR);
    if (bundle.sessions) for (const [sid, data] of Object.entries(bundle.sessions)) fs.writeFileSync(path.join(SESSIONS_DIR, sid + '.json'), JSON.stringify(data, null, 2), 'utf8');
    fs.mkdirSync(PRESETS_DIR, { recursive: true }); clearJsonDir(PRESETS_DIR);
    if (bundle.presets) for (const [pid, data] of Object.entries(bundle.presets)) fs.writeFileSync(path.join(PRESETS_DIR, pid + '.json'), JSON.stringify(data, null, 2), 'utf8');
    if (bundle.drafts) fs.writeFileSync(DRAFTS_FILE, JSON.stringify(bundle.drafts, null, 2), 'utf8');
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
          ...(opts.thinking ? {
              thinking: { type: 'enabled', clear_thinking: false },   // clear_thinking:false = Preserved Thinking
              ...(supportsEffort && opts.reasoningEffort && opts.reasoningEffort !== 'max'
                ? { reasoning_effort: opts.reasoningEffort } : {}),
            } : {}),
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

app.whenReady().then(() => {
  copyTreeIfMissing(SOURCE_CONFIG_DIR, CONFIG_DIR);
  copyTreeIfMissing(SOURCE_DATA_DIR, DATA_DIR);
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, DEFAULT_SETTINGS, 'utf8');
  }
  backfillUsage();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
