// Safe bridge between the Electron main process and the UI.
// The UI can ONLY use what's exposed here on window.api — it never sees the API key directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  savePhraseBans: (text) => ipcRenderer.invoke('phrasebans:save', text),
  loadModes: () => ipcRenderer.invoke('modes:load'),
  saveMode: (name, content) => ipcRenderer.invoke('modes:save', name, content),
  loadProject: () => ipcRenderer.invoke('project:load'),
  saveProject: (content) => ipcRenderer.invoke('project:save', content),

  listSessions: () => ipcRenderer.invoke('sessions:list'),
  loadSession: (id) => ipcRenderer.invoke('sessions:load', id),
  saveSession: (data) => ipcRenderer.invoke('sessions:save', data),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  renameSession: (id, title) => ipcRenderer.invoke('sessions:rename', { id, title }),
  setPinned: (id, pinned) => ipcRenderer.invoke('sessions:setPinned', { id, pinned }),
  setSessionFolder: (id, folder) => ipcRenderer.invoke('sessions:setFolder', { id, folder }),
  setSessionLore: (id, lore) => ipcRenderer.invoke('sessions:setLore', { id, lore }),
  searchSessions: (q) => ipcRenderer.invoke('sessions:search', q),

  loadFolders: () => ipcRenderer.invoke('folders:load'),
  saveFolder: (data) => ipcRenderer.invoke('folders:save', data),
  deleteFolder: (id) => ipcRenderer.invoke('folders:delete', { id }),
  toggleFolder: (id, collapsed) => ipcRenderer.invoke('folders:toggle', { id, collapsed }),

  loadBookmarks: () => ipcRenderer.invoke('bookmarks:load'),
  addBookmark: (data) => ipcRenderer.invoke('bookmarks:add', data),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', { id }),

  loadLorebooks: () => ipcRenderer.invoke('lorebooks:load'),
  saveLorebooks: (map) => ipcRenderer.invoke('lorebooks:save', map),

  embedTexts: (texts, query) => ipcRenderer.invoke('lore:embed', { texts, query }),

  loadDrafts: () => ipcRenderer.invoke('drafts:load'),
  saveDraft: (id, text) => ipcRenderer.invoke('drafts:save', { id, text }),

  listPresets: () => ipcRenderer.invoke('presets:list'),
  loadPreset: (id) => ipcRenderer.invoke('presets:load', id),
  savePreset: (data) => ipcRenderer.invoke('presets:save', data),
  deletePreset: (id) => ipcRenderer.invoke('presets:delete', id),

  loadCraftJournal: () => ipcRenderer.invoke('craft:journal:load'),
  appendCraftJournal: (line) => ipcRenderer.invoke('craft:journal:append', line),

  exportMarkdown: (defaultName, content) => ipcRenderer.invoke('export:markdown', { defaultName, content }),

  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),

  cancelStream: (requestId) => ipcRenderer.invoke('chat:cancel', { requestId }),

  // Shape A: local CLI bridge (main → renderer → main). Renderer listens for requests, replies.
  onCliReq: (cb) => { ipcRenderer.on('cli:req', (_e, p) => cb(p)); },
  sendCliRes: (p) => { ipcRenderer.send('cli:res', p); },

  backupExport: () => ipcRenderer.invoke('backup:export'),
  backupRestore: () => ipcRenderer.invoke('backup:import'),

  // Stream a chat completion. onChunk(delta) fires per piece, then onDone(full, finishReason) or onError(msg).
  chatStream: (messages, opts, { onChunk, onDone, onError, onRetry, onThink } = {}) => {
    const requestId = 'r_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);

    const chunkListener = (_e, d) => {
      if (d.requestId !== requestId) return;
      if (d.kind === 'think') { if (onThink) onThink(d.delta); }
      else { if (onChunk) onChunk(d.delta); }
    };
    const retryListener = (_e, d) => { if (d.requestId === requestId && onRetry) onRetry(d.attempt); };
    const doneListener = (_e, d) => { if (d.requestId === requestId) { cleanup(); onDone && onDone(d.full, d.finishReason); } };
    const errListener = (_e, d) => { if (d.requestId === requestId) { cleanup(); onError && onError(d.message); } };

    function cleanup() {
      ipcRenderer.removeListener('chat:chunk', chunkListener);
      ipcRenderer.removeListener('chat:retry', retryListener);
      ipcRenderer.removeListener('chat:done', doneListener);
      ipcRenderer.removeListener('chat:error', errListener);
    }

    ipcRenderer.on('chat:chunk', chunkListener);
    ipcRenderer.on('chat:retry', retryListener);
    ipcRenderer.on('chat:done', doneListener);
    ipcRenderer.on('chat:error', errListener);
    ipcRenderer.invoke('chat:stream', { messages, opts, requestId });
    return requestId;
  },
});
