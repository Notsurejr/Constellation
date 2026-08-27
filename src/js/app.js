// Boots the app once the page is ready.
// Lightweight toast notifications (called from other modules via Constellation.toast).
Constellation.toast = function (msg) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1800);
};

// The single source of truth for model options — populates both the top-bar switcher and Settings.
const MODELS = [
  { id: 'glm-5.3', label: 'glm-5.3 — Flagship' },
  { id: 'glm-5.3-flash', label: 'glm-5.3-flash — Fast · Vision' },
  { id: 'glm-5.2', label: 'glm-5.2' },
  { id: 'glm-5.1', label: 'glm-5.1' },
  { id: 'glm-5-turbo', label: 'glm-5-turbo — Fast' },
  { id: 'glm-5', label: 'glm-5' },
  { id: 'glm-4.7', label: 'glm-4.7 — Latest 4.x' },
  { id: 'glm-4.6', label: 'glm-4.6 — Coding-focused' },
  { id: 'glm-4.5', label: 'glm-4.5 — Agent flagship' },
  { id: 'glm-4.5-air', label: 'glm-4.5-air — Lighter / cheaper' },
  { id: 'glm-4.7-flash', label: 'glm-4.7-flash — Free' },
  { id: 'glm-4.5-flash', label: 'glm-4.5-flash — Free' },
  { id: 'glm-5v-turbo', label: 'glm-5v-turbo — Vision (fast)' },
  { id: 'glm-4.6v', label: 'glm-4.6v — Vision' },
];
let _modelsPopulated = false;
function populateModels(current) {
  const top = document.getElementById('topModel');
  const set = document.getElementById('modelInput');
  if (!_modelsPopulated) {
    for (const m of MODELS) {
      if (top) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.id; top.appendChild(o); }
      if (set) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; set.appendChild(o); }
    }
    const c = document.createElement('option'); c.value = '__custom__'; c.textContent = 'Custom…';
    if (set) set.appendChild(c);   // any provider's model id (OpenRouter & friends)
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

window.addEventListener('DOMContentLoaded', async () => {
  populateModels();
  // Re-trigger a resize so the starfield measures the window correctly after layout.
  window.dispatchEvent(new Event('resize'));

  // Apply saved text-size + chat-width preferences early so layout is right from the first paint.
  try {
    const cfg = await window.api.loadConfig();
    populateModels(cfg.model);   // a custom model id (e.g. OpenRouter's) joins the dropdowns
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
  } catch (e) {}

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
  if (window.Constellation && window.Constellation.cliBridge) {
    window.Constellation.cliBridge.init();
  }
  if (window.Constellation && window.Constellation.chat) {
    await window.Constellation.chat.init();
  }
  document.getElementById('input').focus();

  // Zen mode: fade the chrome so the conversation can breathe full-width. Esc (or the ☾ button) exits.
  const zenBtn = document.getElementById('zenBtn');
  const setZen = (on) => document.body.classList.toggle('zen', on);
  if (zenBtn) zenBtn.addEventListener('click', () => setZen(!document.body.classList.contains('zen')));
  const zenHint = document.getElementById('zenHint');
  if (zenHint) zenHint.addEventListener('click', () => setZen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.settings-overlay.open')) return;   // let overlays close first
    if (document.body.classList.contains('zen')) setZen(false);
  });

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
