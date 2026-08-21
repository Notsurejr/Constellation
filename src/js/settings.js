// Settings overlay: presets, prompts, project instructions, connection, and generation.
// Opened by clicking the ✦ star (bound here, markup in index.html).
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.settings = (function () {
  function $(id) { return document.getElementById(id); }
  let selectedPreset = null;
  let edSystemFiles = [];   // file attachments staged for the system editor while the overlay is open
  let edProjectFiles = [];

  async function open() {
    $('settingsOverlay').classList.add('open');
    // Editors show THIS chat's active instructions (each chat carries its own).
    const p = (Constellation.chat.getPrompts ? Constellation.chat.getPrompts() : { roleplay: '', project: '' });
    $('promptEditor').value = p.roleplay || '';
    $('projectEditor').value = p.project || '';
    edSystemFiles = (p.systemFiles || []).map((f) => ({ name: f.name, text: f.text }));
    edProjectFiles = (p.projectFiles || []).map((f) => ({ name: f.name, text: f.text }));
    renderFileTray('systemFilesTray', edSystemFiles);
    renderFileTray('projectFilesTray', edProjectFiles);
    // Generation + model reflect THIS chat (per-chat).
    const o = Constellation.chat.getOptions ? Constellation.chat.getOptions() : {};
    const msel = $('modelInput');
    if (msel) {
      const cur = o.model || 'glm-5.3';
      if (Array.from(msel.options).some((op) => op.value === cur)) { msel.value = cur; $('customModelField').hidden = true; }
      else { msel.value = '__custom__'; $('customModelField').hidden = false; $('customModelInput').value = cur; }
    }
    if ($('tempInput')) { const tv = o.temperature != null ? o.temperature : 0.8; $('tempInput').value = tv; $('tempVal').textContent = Number(tv).toFixed(2); }
    if ($('topPInput')) { const tpv = o.topP != null ? o.topP : 0.95; $('topPInput').value = tpv; $('topPVal').textContent = Number(tpv).toFixed(2); }
    if ($('maxInput')) { const mv = o.maxTokens || 4096; $('maxInput').value = mv; $('maxVal').textContent = mv; }
    if ($('thinkingInput')) $('thinkingInput').checked = !!o.thinking;
    if ($('effortInput')) $('effortInput').value = o.reasoningEffort || 'max';
    const cps = o.streamCps != null ? o.streamCps : 0;
    if ($('streamInput')) { $('streamInput').value = cpsToSlider(cps); $('streamVal').textContent = cpsLabel(cps); }
    const cwin = o.contextWindow != null ? o.contextWindow : 0;
    if ($('contextWindowInput')) { $('contextWindowInput').value = cwin; $('contextWindowVal').textContent = cwLabel(cwin); }
    // Connection (key/endpoint) + Appearance are global.
    try {
      const cfg = await window.api.loadConfig();
      if ($('apiKeyInput')) $('apiKeyInput').value = cfg.apiKey || '';
      const ep = $('endpointInput');
      if (ep) {
        const cur = cfg.baseUrl || 'https://api.z.ai/api/coding/paas/v4';
        const known = Array.from(ep.options).some((o) => o.value === cur);
        if (known) { ep.value = cur; $('customEndpointField').hidden = true; }
        else { ep.value = 'custom'; $('customEndpointField').hidden = false; $('customEndpointInput').value = cur; }
      }
      const fs2 = cfg.fontScale != null ? cfg.fontScale : 1;
      const chatW = cfg.chatWidth != null ? cfg.chatWidth : 880;
      $('fontInput').value = fs2;
      $('widthInput').value = chatW;
      $('fontVal').textContent = Number(fs2).toFixed(2) + '×';
      $('widthVal').textContent = chatW + 'px';
      $('accentInput').value = cfg.accent || '#9fb8ff';
      if ($('phraseBansEditor')) $('phraseBansEditor').value = cfg.phraseBans || '';
      if ($('cliServerInput')) $('cliServerInput').checked = !!cfg.cliServer;
      const sd = cfg.starDensity != null ? cfg.starDensity : 1;
      const tw = cfg.twinkleSpeed != null ? cfg.twinkleSpeed : 1;
      $('starDensityInput').value = Math.round(sd * 100);
      $('twinkleInput').value = Math.round(tw * 100);
      $('starDensityVal').textContent = sd.toFixed(2) + '×';
      $('twinkleVal').textContent = tw <= 0.001 ? 'Off' : tw.toFixed(2) + '×';
      const fi = cfg.flareIntensity != null ? cfg.flareIntensity : 0.5;
      if ($('flareIntensityInput')) { $('flareIntensityInput').value = Math.round(fi * 100); $('flareIntensityVal').textContent = Math.round(fi * 100) + '%'; }
      if ($('flareRangeInput')) { $('flareRangeInput').value = cfg.flareRange || 140; $('flareRangeVal').textContent = (cfg.flareRange || 140) + 'px'; }
      if ($('flareSizeInput')) { $('flareSizeInput').value = cfg.flareSize || 60; $('flareSizeVal').textContent = (cfg.flareSize || 60) + '%'; }
      if ($('flareBlendInput')) $('flareBlendInput').value = cfg.flareBlend || 'screen';
      if ($('fxEventsInput')) $('fxEventsInput').checked = cfg.fxEvents !== false;
      if ($('fxSizeInput')) { const fx = cfg.fxSize != null ? cfg.fxSize : 1; $('fxSizeInput').value = Math.round(fx * 100); $('fxSizeVal').textContent = fx.toFixed(1) + '×'; }
    } catch (e) {}
    await refreshPresets();
  }

  function close() { $('settingsOverlay').classList.remove('open'); }

  function flash(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1200);
  }

  // Persist the current editors to the active roleplay/project files and apply them live.
  async function applyEditors() {
    const sys = $('promptEditor').value;
    const proj = $('projectEditor').value;
    Constellation.chat.setPrompts({ roleplay: sys, project: proj, systemFiles: edSystemFiles, projectFiles: edProjectFiles });
    Constellation.chat.persist();
  }

  // ---- file attachments for the system/project editors (contents inlined into the system prompt) ----
  function fmtChars(n) { n = Number(n) || 0; return n >= 1000 ? (Math.round(n / 100) / 10) + 'k chars' : n + ' chars'; }
  function renderFileTray(trayId, files) {
    const tray = $(trayId); if (!tray) return;
    tray.replaceChildren();
    for (const f of files) {
      const chip = document.createElement('div'); chip.className = 'attach-chip';
      const ico = document.createElement('span'); ico.className = 'attach-ico'; ico.textContent = '📄';
      const nm = document.createElement('span'); nm.className = 'attach-name'; nm.textContent = f.name; nm.title = f.name;
      const sz = document.createElement('span'); sz.className = 'attach-size'; sz.textContent = fmtChars((f.text || '').length);
      const x = document.createElement('button'); x.className = 'attach-x'; x.type = 'button'; x.title = 'Remove'; x.textContent = '×';
      x.addEventListener('click', () => { const i = files.indexOf(f); if (i !== -1) { files.splice(i, 1); renderFileTray(trayId, files); applyEditors(); } });
      chip.appendChild(ico); chip.appendChild(nm); chip.appendChild(sz); chip.appendChild(x);
      tray.appendChild(chip);
    }
    tray.hidden = files.length === 0;
  }
  // Transient file input: read each selected .md/.txt into the target list, then persist.
  function pickFiles(target, trayId) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = '.md,.markdown,.mdown,.txt,.text,.json,.csv,.log,.org,.rst';
    inp.addEventListener('change', () => {
      const arr = Array.from(inp.files || []);
      let remaining = arr.length;
      if (!remaining) return;
      const done = () => { if (--remaining === 0) { renderFileTray(trayId, target); applyEditors(); } };
      for (const file of arr) {
        const reader = new FileReader();
        reader.onload = () => { target.push({ name: file.name, text: String(reader.result || '') }); done(); };
        reader.onerror = done;
        reader.readAsText(file);
      }
    });
    inp.click();
  }

  async function savePrompt() { await applyEditors(); flash('promptSaved'); }
  async function saveProject() { await applyEditors(); flash('projectSaved'); }

  async function saveConnection() {
    const apiKey = $('apiKeyInput').value.trim();
    const sel = $('endpointInput').value;
    const baseUrl = sel === 'custom'
      ? ($('customEndpointInput').value.trim().replace(/\/+$/, '') || 'https://openrouter.ai/api/v1')
      : sel;
    await window.api.saveConfig({ api_key: apiKey, base_url: baseUrl });   // key + endpoint are global; model is per-chat (Generation)
    flash('connSaved');
  }
  async function savePhraseBans() {
    const text = $('phraseBansEditor').value;
    await window.api.savePhraseBans(text);
    if (window.Constellation && window.Constellation.chat && Constellation.chat.setPhraseBans) Constellation.chat.setPhraseBans(text);
    flash('phraseBansSaved');
  }

  // Map the 0–100 flow slider to chars/sec (100 = Instant, stored as 0).
  function sliderToCps(v) {
    v = parseInt(v, 10); if (isNaN(v)) v = 100;
    if (v >= 100) return 0;
    return Math.round(25 * Math.pow(700 / 25, v / 99));
  }
  function cpsToSlider(cps) {
    if (!cps) return 100;
    const v = Math.round(99 * Math.log(cps / 25) / Math.log(700 / 25));
    return Math.max(0, Math.min(99, v));
  }
  function cpsLabel(cps) {
    if (!cps) return 'Instant';
    return cps + ' chars/s';
  }
  function cwLabel(v) {
    v = Number(v) || 0;
    return v <= 0 ? 'Off' : Math.round(v / 1000) + 'k';
  }

  async function saveGeneration() {
    const model = $('modelInput').value === '__custom__'
      ? ($('customModelInput').value.trim() || 'glm-5.3')
      : ($('modelInput').value.trim() || 'glm-5.3');
    const temperature = parseFloat($('tempInput').value);
    const topP = parseFloat($('topPInput').value);
    const maxTokens = parseInt($('maxInput').value, 10);
    const thinking = $('thinkingInput').checked;
    const reasoningEffort = $('effortInput').value;
    const streamCps = sliderToCps($('streamInput').value);
    const contextWindow = parseInt($('contextWindowInput').value, 10) || 0;
    // Per-chat: apply to this chat and persist with it.
    Constellation.chat.setOptions({ model, temperature, topP, maxTokens, thinking, reasoningEffort, streamCps, contextWindow });
    Constellation.chat.persist();
    // Also update the global default so new chats inherit these preferences.
    await window.api.saveConfig({ model, temperature, top_p: topP, max_tokens: maxTokens, thinking, reasoning_effort: reasoningEffort, stream_cps: streamCps, context_window: contextWindow });
    flash('genSaved');
  }

  function applyAppearanceVars(fontScale, chatWidth) {
    document.documentElement.style.setProperty('--font-scale', fontScale);
    document.documentElement.style.setProperty('--chat-col', chatWidth + 'px');
  }

  // Push starfield density/twinkle live (boot, slider drag, and save all use this).
  function applyStarfield(density, twinkle) {
    if (window.Constellation && window.Constellation.starfield) {
      window.Constellation.starfield.setDensity(density);
      window.Constellation.starfield.setTwinkle(twinkle);
    }
  }

  // Recolor the accent (and the bubble/glow derived from it) from one hex. Falsy = theme default.
  function applyAccent(hex) {
    const root = document.documentElement.style;
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) {
      root.removeProperty('--accent');
      root.removeProperty('--accent-dim');
      root.removeProperty('--user-bubble');
      root.removeProperty('--glow');
      return;
    }
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    root.setProperty('--accent', hex);
    root.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, 0.5)`);
    root.setProperty('--user-bubble', `rgba(${r}, ${g}, ${b}, 0.16)`);
    root.setProperty('--glow', `0 0 18px rgba(${r}, ${g}, ${b}, 0.25)`);
  }

  async function saveAppearance() {
    const fontScale = parseFloat($('fontInput').value);
    const chatWidth = parseInt($('widthInput').value, 10);
    const accent = $('accentInput').value;
    const starDensity = Number($('starDensityInput').value) / 100;
    const twinkleSpeed = Number($('twinkleInput').value) / 100;
    await window.api.saveConfig({ font_scale: fontScale, chat_width: chatWidth, accent, star_density: starDensity, twinkle_speed: twinkleSpeed });
    applyAppearanceVars(fontScale, chatWidth);
    applyAccent(accent);
    applyStarfield(starDensity, twinkleSpeed);
    flash('appearSaved');
  }
  // Push the current Color-atmosphere inputs to the live engine (used by every live slider + Save).
  function applyColorFx() {
    if (!(window.Constellation && window.Constellation.colorfx)) return;
    window.Constellation.colorfx.setParams({
      intensity: Number($('flareIntensityInput').value) / 100,
      range: parseInt($('flareRangeInput').value, 10),
      size: parseInt($('flareSizeInput').value, 10),
      blend: $('flareBlendInput').value,
      events: $('fxEventsInput').checked,
      fxSize: Number($('fxSizeInput').value) / 100,
    });
  }
  async function saveColorFx() {
    await window.api.saveConfig({
      flare_intensity: Number($('flareIntensityInput').value) / 100,
      flare_range: parseInt($('flareRangeInput').value, 10),
      flare_size: parseInt($('flareSizeInput').value, 10),
      flare_blend: $('flareBlendInput').value,
      fx_events: $('fxEventsInput').checked ? 'on' : 'off',
      fx_size: Number($('fxSizeInput').value) / 100,
    });
    applyColorFx();
    flash('colorFxSaved');
  }

  async function resetAccent() {
    $('accentInput').value = '#9fb8ff';
    applyAccent(null);   // clear override → back to the theme default
    await window.api.saveConfig({ accent: '' });
    flash('appearSaved');
  }

  async function backupExport() {
    try {
      const r = await window.api.backupExport();
      if (r && r.ok) { if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Backed up ' + (r.sessions || 0) + ' chats'); }
      else if (r && r.error) { if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Backup failed: ' + r.error); }
    } catch (e) {}
  }
  async function backupRestore() {
    try {
      const r = await window.api.backupRestore();
      if (r && r.ok) {
        if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Restored ' + (r.sessions || 0) + ' chats — reloading…');
        setTimeout(() => location.reload(), 1200);   // reload to fully apply the restored data
      } else if (r && r.error) {
        if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Restore failed: ' + r.error);
      }
    } catch (e) {}
  }

  // ---- Presets (saved sets of system + project instructions) ----

  async function refreshPresets() {
    let list = [];
    try { list = await window.api.listPresets(); } catch (e) {}
    const el = $('presetList');
    if (!el) return;
    el.replaceChildren();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-empty';
      empty.textContent = 'No presets yet — save one below.';
      el.appendChild(empty);
      return;
    }
    for (const p of list) {
      const row = document.createElement('div');
      row.className = 'preset-item' + (p.id === selectedPreset ? ' active' : '');
      row.dataset.id = p.id;
      const name = document.createElement('span');
      name.className = 'preset-name';
      name.textContent = p.name || 'Untitled';
      const del = document.createElement('button');
      del.className = 'preset-del';
      del.type = 'button';
      del.textContent = '×';
      del.title = 'Delete preset';
      row.appendChild(name);
      row.appendChild(del);
      el.appendChild(row);
    }
  }

  async function loadPreset(id) {
    if (!id) return;
    let p;
    try { p = await window.api.loadPreset(id); } catch (e) { return; }
    selectedPreset = p.id;
    $('promptEditor').value = p.system || '';
    $('projectEditor').value = p.project || '';
    $('presetName').value = p.name || '';
    await applyEditors();
    refreshPresets();
    if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Loaded "' + (p.name || 'preset') + '"');
  }

  async function savePreset() {
    const name = $('presetName').value.trim();
    if (!name) { flash('presetSaved'); return; }   // need a name to save
    const system = $('promptEditor').value;
    const project = $('projectEditor').value;
    // Reuse a preset that already has this exact name (update it); otherwise create a brand-new one.
    let id = null;
    let list = [];
    try { list = await window.api.listPresets(); } catch (e) {}
    const match = list.find((p) => p.name === name);
    if (match) id = match.id;
    const res = await window.api.savePreset({ id, name, system, project });
    selectedPreset = res.id;
    await refreshPresets();
    flash('presetSaved');
  }

  async function deletePreset(id) {
    if (!id) return;
    await window.api.deletePreset(id);
    if (id === selectedPreset) { selectedPreset = null; $('presetName').value = ''; }
    refreshPresets();
  }

  function init() {
    $('brandBtn').addEventListener('click', () => {
      if ($('settingsOverlay').classList.contains('open')) close(); else open();
    });
    $('closeSettings').addEventListener('click', close);
    $('savePrompt').addEventListener('click', savePrompt);
    $('saveProject').addEventListener('click', saveProject);
    const sfb = $('systemFileBtn'); if (sfb) sfb.addEventListener('click', () => pickFiles(edSystemFiles, 'systemFilesTray'));
    const pfb = $('projectFileBtn'); if (pfb) pfb.addEventListener('click', () => pickFiles(edProjectFiles, 'projectFilesTray'));
    $('saveConnection').addEventListener('click', saveConnection);
    const spb = $('savePhraseBans'); if (spb) spb.addEventListener('click', savePhraseBans);
    const cli = $('cliServerInput'); if (cli) cli.addEventListener('change', () => window.api.saveConfig({ cli_server: cli.checked ? 'on' : 'off' }));
    const epSel = $('endpointInput');
    if (epSel) epSel.addEventListener('change', () => {
      const custom = epSel.value === 'custom';
      $('customEndpointField').hidden = !custom;
      if (custom) { $('customEndpointInput').focus(); }
    });
    const mSel2 = $('modelInput');
    if (mSel2) mSel2.addEventListener('change', () => {
      const custom = mSel2.value === '__custom__';
      $('customModelField').hidden = !custom;
      if (custom) { $('customModelInput').focus(); }
    });
    $('saveGeneration').addEventListener('click', saveGeneration);
    $('savePreset').addEventListener('click', savePreset);
    const pl = $('presetList');
    if (pl) pl.addEventListener('click', (e) => {
      const row = e.target.closest('.preset-item');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('.preset-del')) deletePreset(id);
      else loadPreset(id);
    });
    $('tempInput').addEventListener('input', () => { $('tempVal').textContent = Number($('tempInput').value).toFixed(2); });
    $('topPInput').addEventListener('input', () => { $('topPVal').textContent = Number($('topPInput').value).toFixed(2); });
    $('maxInput').addEventListener('input', () => { $('maxVal').textContent = $('maxInput').value; });
    $('contextWindowInput').addEventListener('input', () => { $('contextWindowVal').textContent = cwLabel($('contextWindowInput').value); });
    $('streamInput').addEventListener('input', () => {
      $('streamVal').textContent = cpsLabel(sliderToCps($('streamInput').value));
    });
    $('fontInput').addEventListener('input', () => {
      $('fontVal').textContent = Number($('fontInput').value).toFixed(2) + '×';
      applyAppearanceVars(Number($('fontInput').value), Number($('widthInput').value));   // live preview
    });
    $('widthInput').addEventListener('input', () => {
      $('widthVal').textContent = $('widthInput').value + 'px';
      applyAppearanceVars(Number($('fontInput').value), Number($('widthInput').value));   // live preview
    });
    $('accentInput').addEventListener('input', () => { applyAccent($('accentInput').value); });
    $('starDensityInput').addEventListener('input', () => {
      const v = Number($('starDensityInput').value) / 100;
      $('starDensityVal').textContent = v.toFixed(2) + '×';
      applyStarfield(v, Number($('twinkleInput').value) / 100);
    });
    $('twinkleInput').addEventListener('input', () => {
      const v = Number($('twinkleInput').value) / 100;
      $('twinkleVal').textContent = v <= 0.001 ? 'Off' : v.toFixed(2) + '×';
      applyStarfield(Number($('starDensityInput').value) / 100, v);
    });
    const liveFlare = applyColorFx;
    if ($('flareIntensityInput')) $('flareIntensityInput').addEventListener('input', () => { $('flareIntensityVal').textContent = $('flareIntensityInput').value + '%'; liveFlare(); });
    if ($('flareRangeInput')) $('flareRangeInput').addEventListener('input', () => { $('flareRangeVal').textContent = $('flareRangeInput').value + 'px'; liveFlare(); });
    if ($('flareSizeInput')) $('flareSizeInput').addEventListener('input', () => { $('flareSizeVal').textContent = $('flareSizeInput').value + '%'; liveFlare(); });
    if ($('flareBlendInput')) $('flareBlendInput').addEventListener('change', liveFlare);
    if ($('fxEventsInput')) $('fxEventsInput').addEventListener('change', liveFlare);
    if ($('fxSizeInput')) $('fxSizeInput').addEventListener('input', () => { $('fxSizeVal').textContent = (Number($('fxSizeInput').value) / 100).toFixed(1) + '×'; liveFlare(); });
    const scf = $('saveColorFx'); if (scf) scf.addEventListener('click', saveColorFx);
    $('resetAccent').addEventListener('click', resetAccent);
    $('saveAppearance').addEventListener('click', saveAppearance);
    $('backupBtn').addEventListener('click', backupExport);
    $('restoreBtn').addEventListener('click', backupRestore);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('settingsOverlay').classList.contains('open')) close();
    });
  }

  return { init };
})();
