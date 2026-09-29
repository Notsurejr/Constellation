// Cast: imported character cards + the user's personas, kept entirely separate from regular
// chats. The only bridge into the chat world is "Start chat", which SEEDS an ordinary
// Constellation chat — compiled system prompt (base instructions + card + persona), the
// chosen greeting as the first assistant message, and the card's embedded lorebook attached.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.cast = (function () {
  const CC = () => (window.Constellation && window.Constellation.cardcompile) || null;
  let overlay = null, startScr = null;
  let personas = [];          // [{id, name, description, default}]
  let characters = [];        // imported card records

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const esc = (s) => String(s == null ? '' : s);

  async function loadAll() {
    try { personas = await window.api.loadPersonas(); } catch (e) { personas = [{ id: 'p_default', name: 'You', description: '', default: true }]; }
    if (!personas.length) personas = [{ id: 'p_default', name: 'You', description: '', default: true }];
    try { characters = await window.api.listCharacters(); } catch (e) { characters = []; }
  }

  async function savePersonas() {
    try { await window.api.savePersonas(personas); } catch (e) { console.warn('[constellation]', e && e.message || e); }
    if (window.Constellation && window.Constellation.sessions) window.Constellation.sessions.refresh();   // badges may show persona/char names
  }

  // ---- personas section ----
  function personaRow(p) {
    const row = el('div', 'cast-persona');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'persona-default'; radio.checked = !!p.default;
    radio.title = 'Default persona';
    radio.addEventListener('change', () => { if (radio.checked) { personas.forEach((q) => { q.default = q.id === p.id; }); savePersonas(); renderPersonas(); } });
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'cast-persona-name'; name.value = esc(p.name); name.maxLength = 40; name.placeholder = 'Persona name';
    name.addEventListener('change', () => { p.name = name.value.trim() || 'You'; savePersonas(); });
    const desc = document.createElement('textarea');
    desc.className = 'cast-persona-desc'; desc.value = esc(p.description); desc.placeholder = 'Optional — who you play: appearance, background, how you should be written. Substituted for {{user}} in cards.';
    desc.rows = 2;
    desc.addEventListener('change', () => { p.description = desc.value; savePersonas(); });
    const del = el('button', 'cast-mini-btn', '×'); del.title = 'Delete persona';
    del.addEventListener('click', () => {
      if (personas.length <= 1) return;   // always at least one
      personas = personas.filter((q) => q.id !== p.id);
      if (p.default && personas[0]) personas[0].default = true;
      savePersonas(); renderPersonas();
    });
    row.appendChild(radio); row.appendChild(name); row.appendChild(del); row.appendChild(desc);
    return row;
  }

  function renderPersonas(host) {
    const wrap = host.querySelector('.cast-personas') || host;
    wrap.replaceChildren();
    wrap.appendChild(el('div', 'cast-subhead', 'You — personas ({{user}})'));
    personas.forEach((p) => wrap.appendChild(personaRow(p)));
    const add = el('button', 'btn ghost cast-add-persona', '+ New persona');
    add.addEventListener('click', () => {
      personas.push({ id: 'p_' + Date.now().toString(36), name: 'New persona', description: '' });
      savePersonas(); renderPersonas(host);
    });
    wrap.appendChild(add);
  }

  // ---- characters section ----
  function greetingCount(c) { return 1 + (c.altGreetings ? c.altGreetings.length : 0); }

  function characterCard(c) {
    const card = el('div', 'cast-card');
    const head = el('div', 'cast-card-head');
    if (c.avatar) {
      const img = document.createElement('img');
      img.className = 'cast-avatar'; img.src = c.avatar; img.alt = c.name;
      head.appendChild(img);
    } else {
      head.appendChild(el('div', 'cast-avatar cast-avatar-blank', esc(c.name).slice(0, 1).toUpperCase() || '?'));
    }
    const meta = el('div', 'cast-card-meta');
    meta.appendChild(el('div', 'cast-card-name', esc(c.name)));
    const sub = el('div', 'cast-card-sub');
    const bits = [];
    if (c.creator) bits.push('by ' + esc(c.creator));
    bits.push(greetingCount(c) + (greetingCount(c) === 1 ? ' greeting' : ' greetings'));
    if (c.characterBook) bits.push('embedded lorebook');
    if (c.hasSystemPrompt || c.hasPhi) bits.push('card system directives — ignored');
    sub.textContent = bits.join(' · ');
    meta.appendChild(sub);
    if (c.tags && c.tags.length) meta.appendChild(el('div', 'cast-card-tags', c.tags.slice(0, 6).join(' · ')));
    head.appendChild(meta);
    card.appendChild(head);

    const body = el('div', 'cast-card-desc');
    body.textContent = esc(c.description).replace(/\s+/g, ' ').slice(0, 220) + (esc(c.description).length > 220 ? '…' : '');
    body.hidden = true;
    card.appendChild(body);

    const acts = el('div', 'cast-card-actions');
    const start = el('button', 'btn', 'Start chat');
    start.addEventListener('click', () => openStart(c));
    const more = el('button', 'btn ghost', 'Details');
    more.addEventListener('click', () => { body.hidden = !body.hidden; more.textContent = body.hidden ? 'Details' : 'Less'; });
    const del = el('button', 'btn ghost', 'Delete');
    del.addEventListener('click', async () => {
      try { await window.api.deleteCharacter(c.id); } catch (e) { console.warn('[constellation]', e && e.message || e); }
      await loadAll(); render();
    });
    acts.appendChild(start); acts.appendChild(more); acts.appendChild(del);
    card.appendChild(acts);
    return card;
  }

  function render() {
    if (!overlay) return;
    const host = overlay.querySelector('.cast-body');
    host.replaceChildren();

    const pwrap = el('div', 'cast-personas');
    host.appendChild(pwrap);
    renderPersonas(pwrap);

    const chead = el('div', 'cast-subhead', 'Characters');
    const imp = el('button', 'btn cast-import', 'Import cards…');
    imp.addEventListener('click', async () => {
      try {
        const r = await window.api.importCharacters();
        if (r && r.ok && r.results) {
          const n = r.results.filter((x) => x.ok).length;
          const bad = r.results.filter((x) => !x.ok);
          if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Imported ' + n + ' character' + (n === 1 ? '' : 's') + (bad.length ? ' — ' + bad.length + ' failed' : ''));
        }
        await loadAll(); render();
      } catch (e) { console.warn('[constellation]', e && e.message || e); }
    });
    chead.appendChild(imp);
    host.appendChild(chead);

    if (!characters.length) {
      host.appendChild(el('div', 'cast-empty', 'No characters yet. Import a character card (chara_card_v2 JSON — JanitorAI/Chub export) to begin.'));
      return;
    }
    characters.forEach((c) => host.appendChild(characterCard(c)));
  }

  // ---- the start screen: greeting + base + persona + editable compiled preview ----
  function closeStart() { if (startScr) { startScr.remove(); startScr = null; } }

  async function openStart(card) {
    closeStart();
    const cc = CC();
    let presets = [];
    try { presets = await window.api.listPresets() || []; } catch (e) { console.warn('[constellation]', e && e.message || e); }
    let defaultRp = '';
    try { defaultRp = ((await window.api.loadModes()).roleplay || ''); } catch (e) { console.warn('[constellation]', e && e.message || e); }

    startScr = el('div', 'cast-start-overlay');
    const box = el('div', 'cast-start');
    box.appendChild(el('div', 'cast-start-title', 'Start chat — ' + card.name));

    // greeting picker
    const greetings = [{ label: 'Greeting (default)', text: card.firstMes || '' }]
      .concat((card.altGreetings || []).map((g, i) => ({ label: 'Alternate ' + (i + 2), text: g })))
      .filter((g) => g.text && g.text.trim());
    const gRow = el('label', 'cast-start-row');
    gRow.appendChild(el('span', 'cast-start-lbl', 'Greeting'));
    const gSel = document.createElement('select');
    greetings.forEach((g, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = g.label + (g.text.length > 60 ? ' — ' + g.text.replace(/\s+/g, ' ').slice(0, 50) + '…' : ''); gSel.appendChild(o); });
    gRow.appendChild(gSel);
    box.appendChild(gRow);

    // base instructions
    const bRow = el('div', 'cast-start-row');
    bRow.appendChild(el('span', 'cast-start-lbl', 'Base'));
    const baseWrap = el('div', 'cast-base-opts');
    const mkRadio = (id, label) => {
      const l = el('label', 'cast-base-opt');
      const r = document.createElement('input'); r.type = 'radio'; r.name = 'cast-base'; r.value = id;
      l.appendChild(r); l.appendChild(document.createTextNode(label));
      baseWrap.appendChild(l); return r;
    };
    const rDefault = mkRadio('default', 'My roleplay instructions');
    rDefault.checked = true;
    mkRadio('preset', 'Preset:');
    const pSel = document.createElement('select');
    pSel.className = 'cast-preset-sel';
    presets.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name || p.id; pSel.appendChild(o); });
    if (!presets.length) { const o = document.createElement('option'); o.textContent = '(no presets saved)'; o.disabled = true; pSel.appendChild(o); }
    baseWrap.appendChild(pSel);
    mkRadio('none', 'None — card only');
    bRow.appendChild(baseWrap);
    box.appendChild(bRow);

    // persona
    const perRow = el('label', 'cast-start-row');
    perRow.appendChild(el('span', 'cast-start-lbl', 'Persona'));
    const perSel = document.createElement('select');
    personas.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; if (p.default) o.selected = true; perSel.appendChild(o); });
    perRow.appendChild(perSel);
    box.appendChild(perRow);

    // compiled preview
    const pvHead = el('div', 'cast-preview-head');
    pvHead.appendChild(el('span', '', 'Compiled system prompt — editable before first send'));
    const tok = el('em', 'cast-tok-est', '');
    pvHead.appendChild(tok);
    box.appendChild(pvHead);
    const pv = document.createElement('textarea');
    pv.className = 'cast-preview';
    pv.spellcheck = false;
    box.appendChild(pv);

    let userEdited = false;
    const currentBase = () => {
      const v = baseWrap.querySelector('input[name="cast-base"]:checked');
      if (!v) return '';
      if (v.value === 'default') return defaultRp;
      if (v.value === 'preset') {
        const p = presets.find((x) => String(x.id) === pSel.value);
        return p ? String(p.system || p.roleplay || '') : '';
      }
      return '';
    };
    const recompile = () => {
      const persona = personas.find((p) => p.id === perSel.value) || personas[0];
      const text = cc.assemble(currentBase(), card, persona, persona ? persona.name : 'You');
      pv.value = text;
      userEdited = false;
      tok.textContent = '~' + cc.estimateTokens(text) + ' tokens';
    };
    recompile();
    baseWrap.addEventListener('change', recompile);
    pSel.addEventListener('change', () => { const r = baseWrap.querySelector('input[value="preset"]'); if (r) r.checked = true; recompile(); });
    perSel.addEventListener('change', recompile);
    pv.addEventListener('input', () => { userEdited = true; tok.textContent = '~' + cc.estimateTokens(pv.value) + ' tokens (edited)'; });

    const bar = el('div', 'cast-start-bar');
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.addEventListener('click', closeStart);
    const go = el('button', 'btn', 'Start chat');
    go.addEventListener('click', () => startChat(card, { greeting: greetings[parseInt(gSel.value, 10) || 0], system: pv.value, personaId: perSel.value }));
    bar.appendChild(cancel); bar.appendChild(go);
    box.appendChild(bar);

    startScr.appendChild(box);
    startScr.addEventListener('mousedown', (e) => { if (e.target === startScr) closeStart(); });
    document.body.appendChild(startScr);
  }

  // Seed the chat: lorebook (if the card carries one) → session (compiled system + greeting)
  // → switch into it. From here it is an ordinary Constellation chat.
  async function startChat(card, opts) {
    const cc = CC();
    const persona = personas.find((p) => p.id === opts.personaId) || personas[0];
    const userName = persona ? persona.name : 'You';
    let loreIds = [];
    try {
      const book = cc.bookToLore(card);
      if (book) {
        const map = await window.api.loadLorebooks();
        const id = 'lb_' + card.id;
        map[id] = { id: id, name: book.name, entries: book.entries };
        await window.api.saveLorebooks(map);
        loreIds = [id];
      }
    } catch (e) { console.warn('[constellation]', e && e.message || e); }

    let genModel = 'glm-5.3';
    try { const o = (Constellation.chat.getOptions ? Constellation.chat.getOptions() : {}); genModel = o.model || genModel; } catch (e) { console.warn('[constellation]', e && e.message || e); }
    const messages = [{ role: 'assistant', content: cc.substitute(opts.greeting.text || '', card.name, userName) }];
    const res = await window.api.saveSession({
      id: null, title: card.name, messages,
      system: opts.system, project: '', gen: { model: genModel },
      lore: loreIds, character: { id: card.id, name: card.name },
    });
    closeStart();
    close();
    if (window.Constellation && window.Constellation.sessions && Constellation.sessions.load) await Constellation.sessions.load(res.id);
    if (window.Constellation && window.Constellation.toast) window.Constellation.toast('Started chat with ' + card.name);
  }

  // ---- panel shell ----
  function open() {
    if (overlay) { close(); return; }
    overlay = el('div', 'cast-overlay');
    const panel = el('div', 'cast-panel');
    const head = el('div', 'cast-head');
    head.appendChild(el('div', 'cast-title', '♛ Cast'));
    const x = el('button', 'cast-close', '×'); x.title = 'Close';
    x.addEventListener('click', close);
    head.appendChild(x);
    panel.appendChild(head);
    panel.appendChild(el('div', 'cast-hint', 'Characters live apart from your chats. "Start chat" seeds a normal chat: your chosen instructions on top, the card beneath, your persona after — all editable before the first send.'));
    const body = el('div', 'cast-body');
    panel.appendChild(body);
    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    loadAll().then(render);
  }
  function close() { if (overlay) { overlay.remove(); overlay = null; } }

  function init() {
    const btn = document.getElementById('castBtn');
    if (btn) btn.addEventListener('click', open);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (startScr) closeStart(); else if (overlay) close(); } });
  }

  return { init: init, open: open, close: close, refresh: function () { if (overlay) loadAll().then(render); } };
})();
