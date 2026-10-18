// Boots the app once the page is ready.
// Lightweight toast notifications (called from other modules via Constellation.toast).
// linger (ms) overrides the default — errors pass a longer one so they're readable in hindsight.
Constellation.toast = function (msg, linger) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = 'toast' + (linger >= 5000 ? ' sticky' : '');
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, linger || 1800);
};

// Model options come from the ACTIVE CONNECTION's list (Settings → Connection); this
// fallback seeds the dropdowns before the connection loads (first-boot / race cover).
const FALLBACK_MODELS = [
  { id: 'glm-5.3', label: 'glm-5.3 — Flagship' },
  { id: 'glm-5.3-flash', label: 'glm-5.3-flash — Fast · Vision' },
  { id: 'glm-5.2', label: 'glm-5.2' },
  { id: 'glm-5.1', label: 'glm-5.1' },
  { id: 'glm-4.7', label: 'glm-4.7 — Latest 4.x' },
];
let _modelsPopulated = false;
function populateModels(current) {
  const top = document.getElementById('topModel');
  const set = document.getElementById('modelInput');
  if (!_modelsPopulated) {
    for (const m of FALLBACK_MODELS) {
      if (top) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.id; top.appendChild(o); }
      if (set) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; set.appendChild(o); }
    }
    const c = document.createElement('option'); c.value = '__custom__'; c.textContent = 'Custom…';
    if (set) set.appendChild(c);
    _modelsPopulated = true;
  }
  if (current) {   // a custom model id from settings stays selectable in both dropdowns
    for (const sel of [top, set]) {
      if (sel && !Array.from(sel.options).some((o) => o.value === current)) {
        const o = document.createElement('option'); o.value = current; o.textContent = current;
        sel.appendChild(o);
      }
    }
  }
}
// Replace both dropdowns with the active connection's model list (called at boot once the
// connection resolves, and after every connections save — 'constellation:connections' event).
async function populateModelsFromConnection() {
  try {
    const conn = await window.api.activeConnection();
    const models = (conn && conn.models && conn.models.length) ? conn.models : FALLBACK_MODELS;
    for (const selId of ['topModel', 'modelInput']) {
      const sel = document.getElementById(selId);
      if (!sel) continue;
      const cur = sel.value;
      sel.innerHTML = '';
      for (const m of models) {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = selId === 'topModel' ? m.id : (m.label || m.id);
        sel.appendChild(o);
      }
      if (selId === 'modelInput') {
        const c = document.createElement('option'); c.value = '__custom__'; c.textContent = 'Custom…'; sel.appendChild(c);
      }
      if (cur && Array.from(sel.options).some((o) => o.value === cur)) sel.value = cur;
      else if (models.length) sel.value = models[0].id;
    }
    if (window.Constellation && window.Constellation.settings && Constellation.settings.syncEffortOptions) Constellation.settings.syncEffortOptions();
  } catch (e) { console.warn('[constellation]', e && e.message || e); }
}
// Any save (Settings panel, IPC, or otherwise) rebuilds the dropdowns — the main process
// broadcasts connections:changed after every successful save; the DOM event covers panel-local saves.
async function onConnectionsChanged() {
  await populateModelsFromConnection();
  // If the active chat's model isn't offered by the new connection, fall in line with the
  // connection's first model (per-chat model choice stays sacred when still available).
  try {
    const conn = await window.api.activeConnection();
    const ids = (conn.models || []).map((m) => m.id);
    const chat = window.Constellation && window.Constellation.chat;
    if (conn && ids.length && chat && chat.getOptions && chat.setOptions) {
      const cur = chat.getOptions().model;
      if (cur && !ids.includes(cur)) chat.setOptions({ model: conn.activeModel && ids.includes(conn.activeModel) ? conn.activeModel : ids[0] });
    }
  } catch (e) { console.warn('[constellation]', e && e.message || e); }
}
window.addEventListener('constellation:connections', onConnectionsChanged);
if (window.api && window.api.onConnectionsChanged) {
  window.api.onConnectionsChanged(onConnectionsChanged);
}

window.addEventListener('DOMContentLoaded', async () => {
  populateModels();
  // Re-trigger a resize so the starfield measures the window correctly after layout.
  window.dispatchEvent(new Event('resize'));

  // Apply saved text-size + chat-width preferences early so layout is right from the first paint.
  try {
    const cfg = await window.api.loadConfig();
    populateModels(cfg.model);   // a custom model id (e.g. OpenRouter's) joins the dropdowns
    populateModelsFromConnection();   // then the active connection's list takes over
    const fs2 = cfg.fontScale != null ? cfg.fontScale : 1;
    const cw = cfg.chatWidth != null ? cfg.chatWidth : 880;
    document.documentElement.style.setProperty('--font-scale', fs2);
    document.documentElement.style.setProperty('--chat-col', cw + 'px');
    const am = /^#([0-9a-f]{6})$/i.exec(String(cfg.accent || ''));
    if (am) {
      const r = parseInt(am[1].slice(0, 2), 16);
      const g = parseInt(am[1].slice(2, 4), 16);
      const b = parseInt(am[1].slice(4, 6), 16);
      const root = document.documentElement.style;
      root.setProperty('--accent', cfg.accent);
      root.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, 0.5)`);
      root.setProperty('--user-bubble', `rgba(${r}, ${g}, ${b}, 0.16)`);
      root.setProperty('--glow', `0 0 18px rgba(${r}, ${g}, ${b}, 0.25)`);
    }
    if (window.Constellation && window.Constellation.starfield) {
      window.Constellation.starfield.setDensity(cfg.starDensity != null ? cfg.starDensity : 1);
      window.Constellation.starfield.setTwinkle(cfg.twinkleSpeed != null ? cfg.twinkleSpeed : 1);
    }
    if (window.Constellation && window.Constellation.colorfx) {
      window.Constellation.colorfx.setParams({ intensity: cfg.flareIntensity != null ? cfg.flareIntensity : 0.5, range: cfg.flareRange || 140, size: cfg.flareSize || 35, blend: cfg.flareBlend || 'screen', events: cfg.fxEvents !== false, fxSize: cfg.fxSize != null ? cfg.fxSize : 1, colorWords: cfg.colorWords !== false });
    }
    if (window.Constellation.mood) window.Constellation.mood.setEnabled(cfg.moodSky !== false);
  } catch (e) { console.warn('[constellation]', e && e.message || e); }

  if (window.Constellation && window.Constellation.settings) {
    window.Constellation.settings.init();
  }
  if (window.Constellation && window.Constellation.sessions) {
    window.Constellation.sessions.init();
  }
  if (window.Constellation && window.Constellation.craft) {
    window.Constellation.craft.init();
  }
  if (window.Constellation && window.Constellation.bookmarks) {
    window.Constellation.bookmarks.init();
  }
  if (window.Constellation && window.Constellation.lorebook) {
    window.Constellation.lorebook.init();
  }
  if (window.Constellation && window.Constellation.cast) {
    window.Constellation.cast.init();
  }
  if (window.Constellation && window.Constellation.cliBridge) {
    window.Constellation.cliBridge.init();
  }
  if (window.Constellation && window.Constellation.chat) {
    await window.Constellation.chat.init();
  }
  document.getElementById('input').focus();

  // Shortcuts overlay — toggle with ? or the ? button.
  const sc = document.getElementById('shortcutsOverlay');
  const toggleShortcuts = () => { if (sc) sc.classList.toggle('open'); };
  const scBtn = document.getElementById('shortcutsBtn');
  if (scBtn) scBtn.addEventListener('click', toggleShortcuts);
  const scClose = document.getElementById('closeShortcuts');
  if (scClose) scClose.addEventListener('click', () => sc && sc.classList.remove('open'));
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !/input|textarea/i.test(String(e.target.tagName || ''))) { e.preventDefault(); toggleShortcuts(); }
  });
});
