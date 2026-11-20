// e2e runner — boots the REAL app in an isolated profile on dedicated ports (CLI 7333,
// mock 7391, CDP 9233), drives it over CDP, and verifies boot health, full-shape fixture
// rendering, and the consolidated feature regressions. Teardown kills only the processes
// it spawned and deletes its own profile. The shared lab and the installed app untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnMock, sleep } from '../helpers/mock.mjs';
import { launchApp, E2E_CDP_PORT } from '../helpers/electron.mjs';
import { stageProfile, stageSmallChat, FIXTURE_ID, TINY_WAV } from '../helpers/fixtures.mjs';

const PROFILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.e2e-profile');
const results = [];
const pageErrors = [];
let current = { name: '(setup)', failures: 0 };

function record(name, ok, detail) {
  results.push({ suite: current.name, name, ok, detail: detail == null ? '' : String(detail).slice(0, 220) });
  if (!ok) current.failures++;
  console.log((ok ? '  ✔ ' : '  ✖ ') + name + (detail ? ' — ' + String(detail).slice(0, 160) : ''));
}
async function t(name, fn) { try { await fn(); record(name, true); } catch (e) { record(name, false, e.message); } }

// wipe + stage the disposable profile BEFORE boot (a leftover profile from a crashed run
// may still be file-locked — retry, then tolerate: staging rewrites every file we manage)
fs.mkdirSync(PROFILE, { recursive: true });
for (let i = 0; i < 3; i++) {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); break; } catch (e) { await sleep(600); }
}
fs.mkdirSync(PROFILE, { recursive: true });
stageProfile(PROFILE);
stageSmallChat(PROFILE);

console.log('== e2e: spawning mock on 7391 and app on CDP ' + E2E_CDP_PORT + ' (isolated profile) ==');
const mock = await spawnMock();
const app = await launchApp({ userData: PROFILE, cliPort: 7333 });

// exception collection is armed BEFORE the boot gate reload
app.ws.onmessage2 = null;
const armExceptions = () => app.call('Runtime.enable');   // events stream into app.events
await armExceptions();

let fatal = null;
try {
  // ---------------- Suite A: boot health gate ----------------
  current = { name: 'A boot health gate', failures: 0 };
  console.log('\n== A. boot health gate ==');
  const errAt = app.events.length;
  await app.call('Page.reload', { ignoreCache: false });
  await sleep(3500);
  const thrown = app.events.slice(errAt).filter((e) => e.method === 'Runtime.exceptionThrown');
  record('reload with exceptions armed: zero boot-time throws', thrown.length === 0, thrown.map((x) => JSON.stringify(x.params.exceptionDetails && x.params.exceptionDetails.exception && x.params.exceptionDetails.exception.description || x.params).slice(0, 120)).join(' | '));
  const boot = await app.ev(`({ booted: !!(window.Constellation && window.Constellation.chat && window.Constellation.md && window.Constellation.sessions), status: (document.getElementById('status')||{}).textContent, msgs: document.querySelectorAll('#messages .msg').length })`);
  record('app namespaces live after reload', !!(boot && boot.booted), JSON.stringify(boot));
  for (const e of app.events.slice(errAt)) if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') pageErrors.push((e.params.args || []).map((a) => a.value || a.description || '').join(' '));
  record('no console.error during boot', !pageErrors.length, pageErrors.slice(0, 3).join(' | '));

  // ---------------- Suite B: full-shape fixture rendering ----------------
  current = { name: 'B full-shape fixture', failures: 0 };
  console.log('\n== B. full-shape fixture ==');
  const errB = app.events.length;
  await app.ev(`window.api.saveConnections({ active: 'c_mock', list: [{ id: 'c_mock', name: 'E2E Mock', baseUrl: 'http://127.0.0.1:7391/v1', models: [{ id: 'mock-1', label: 'Mock Streamer' }], activeModel: 'mock-1' }], keyUpdates: [{ connId: 'c_mock', key: 'e2e-dummy-key' }] })`, true);
  await app.ev(`Constellation.sessions.load('${FIXTURE_ID}')`, true);
  let n = 0;
  for (let i = 0; i < 80; i++) { n = await app.ev(`document.querySelectorAll('#messages .msg').length`); if (n === 6) { await sleep(300); if ((await app.ev(`document.querySelectorAll('#messages .msg').length`)) === 6) break; } await sleep(140); }
  record('all 6 fixture messages render', n === 6, 'count=' + n);
  await app.raise();

  await t('dialogue voice wraps quotes in the rendered fixture', async () => {
    const c = await app.ev(`document.querySelectorAll('#messages .dlg .q').length`);
    assert.ok(c >= 4, 'q marks: ' + c);
  });
  await t('color words tagged', async () => {
    const c = await app.ev(`document.querySelectorAll('#messages .colorword').length`);
    assert.ok(c >= 4, 'colorwords: ' + c);
  });
  await t('preserved thinking restores as a visible block', async () => {
    const s = await app.ev(`(function(){ const b = document.querySelectorAll('#messages .msg')[1].querySelector('.think-block'); return { hidden: b.hidden, open: b.open, len: b.querySelector('.think-body').textContent.length }; })()`);
    assert.equal(s.hidden, false); assert.ok(s.len > 100, JSON.stringify(s));
  });
  await t('variant nav present and flip works', async () => {
    const r = await app.ev(`(async () => {
      const nav = document.querySelector('.variant-nav');
      if (!nav) return { navFound: false, navClasses: Array.from(document.querySelectorAll('[class*="variant"]')).map((x) => x.className).slice(0, 3) };
      const body = nav.closest('.msg').querySelector('.body');
      const before = body.textContent.slice(0, 20);
      const btn = nav.querySelector('button:not([disabled])');
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 350));
      return { navFound: true, changed: body.textContent.slice(0, 20) !== before };
    })()`, true);
    assert.ok(r.navFound && r.changed, JSON.stringify(r));
  });
  await t('lore indicator renders on the stamped reply', async () => {
    const s = await app.ev(`(function(){ const l = document.querySelectorAll('#messages .msg')[1].querySelector('.lore-used'); return l ? l.querySelector('.lore-used-head').textContent : null; })()`);
    assert.ok(s && s.includes('passage'), s);
  });
  await t('attachment chips: text, image thumb, audio ♪', async () => {
    const s = await app.ev(`({
      text: !!document.querySelector('#messages .msg .attach-chip:not(.image):not(.audio)'),
      img: !!document.querySelector('#messages .attach-thumb'),
      aud: !!document.querySelector('#messages .attach-chip.audio'),
      count: document.querySelectorAll('#messages .attach-chip').length
    })`);
    assert.deepEqual({ text: s.text, img: s.img, aud: s.aud }, { text: true, img: true, aud: true }, JSON.stringify(s));
  });
  await t('model stamps on both replies', async () => {
    const c = await app.ev(`document.querySelectorAll('#messages .model-tag').length`);
    assert.equal(c, 2);
  });
  await t('sculpted marker shows on the edited reply', async () => {
    const s = await app.ev(`(function(){ const m = document.querySelectorAll('#messages .msg')[3]; return m.querySelector('.sculpted-tag') ? m.querySelector('.sculpted-tag').textContent : null; })()`);
    assert.ok(s && s.includes('sculpted'), s);
  });
  await t('bookmarked message wears the ★ glyph', async () => {
    const s = await app.ev(`(function(){ const m = document.querySelectorAll('#messages .msg')[1]; return { marked: m.dataset.bookmarked === '1', glyph: (m.querySelector('[data-action="bookmark"]')||{}).textContent }; })()`);
    assert.equal(s.marked, true); assert.equal(s.glyph, '★');
  });
  await t('zero swallowed render errors across the fixture load', async () => {
    const thrown = app.events.slice(errB).filter((e) => e.method === 'Runtime.exceptionThrown');
    assert.deepEqual(thrown, []);
  });

  // ---------------- Suite C: feature regressions ----------------
  current = { name: 'C1 dialogue voices', failures: 0 };
  console.log('\n== C1. dialogue voices ==');
  await t('all six voices wrap quotes with marks in their own .dlg>.q', async () => {
    for (const v of ['chiaroscuro', 'glass', 'editorial', 'acoustic', 'dramatis', 'noir']) {
      await app.ev(`Constellation.chat.applyDialogue({ dialogueStyle: '${v}' })`);
      const s = await app.ev(`({
        cls: document.body.classList.contains('dlg-${v}'),
        q: (() => { const d = document.createElement('div'); d.innerHTML = Constellation.md.render('She said “hi there.” and left.'); return d.querySelectorAll('.dlg .q').length; })()
      })`);
      assert.ok(s.cls && s.q >= 2, v + ': ' + JSON.stringify(s));
    }
    await app.ev(`Constellation.chat.applyDialogue({ dialogueStyle: 'chiaroscuro' })`);
  });
  await t('cross-element quotes keep bold inside the voice', async () => {
    const s = await app.ev(`(function(){ const d = document.createElement('div'); d.innerHTML = Constellation.md.render('“**bold** speech” he said'); return { strongInDlg: !!d.querySelector('.dlg strong, strong.dlg'), dlgCount: d.querySelectorAll('.dlg').length }; })()`);
    assert.ok(s.strongInDlg && s.dlgCount > 0, JSON.stringify(s));
  });
  await t("5'10\" measurement guard: no phantom quote opens", async () => {
    const s = await app.ev(`(function(){ const d = document.createElement('div'); d.innerHTML = Constellation.md.render('He stood 5\\'10" tall and shrugged.'); return d.querySelectorAll('.dlg').length; })()`);
    assert.equal(s, 0);
  });
  await t('spaced emphasis around quotes renders without raw asterisks', async () => {
    const s = await app.ev(`(function(){ const d = document.createElement('div'); d.innerHTML = Constellation.md.render('** “spoken words” **'); return { stars: (d.textContent.match(/\\*/g) || []).length, strong: !!d.querySelector('strong') }; })()`);
    assert.equal(s.stars, 0); assert.equal(s.strong, true);
  });

  current = { name: 'C2 immersion grammar', failures: 0 };
  console.log('\n== C2. immersion grammar ==');
  await t('inline + line registers all render', async () => {
    const src = [
      '++boom++', '^^lift^^', '!! impact line', '...', '::spaced::', '{{whisper}}',
      '||redact||', '==mark==', '~alien~', '[[msg]]', '[[!alert]]', '[beat]',
      '<< earth line *with em*', 'the {{turn}} macro stays literal',
    ].join('\n\n');
    const s = await app.ev(`(function () {
      const d = document.createElement('div');
      d.innerHTML = Constellation.md.render(${JSON.stringify(src)});
      const has = (sel) => !!d.querySelector(sel);
      const text = d.textContent;
      return {
        boom: has('.g-boom'), lift: has('.g-lift'), impact: has('.g-impact'), silence: has('.g-silence'),
        spaced: has('.g-spaced'), whisper: has('.g-whisper'), redact: has('.g-redact'), mark: has('.g-mark'),
        alien: has('.g-alien'), msg: has('.g-msg'), urgent: has('.g-msg.urgent'), beat: has('.g-beat'),
        earth: has('.g-earth'), emInEarth: !!d.querySelector('.g-earth em'),
        bracesKept: text.includes('{{turn}}'), whisperNoBraces: !d.querySelector('.g-whisper').textContent.includes('{{')
      };
    })()`);
    for (const k of ['boom', 'lift', 'impact', 'silence', 'spaced', 'whisper', 'redact', 'mark', 'alien', 'msg', 'urgent', 'beat', 'earth', 'emInEarth', 'bracesKept', 'whisperNoBraces']) {
      assert.equal(s[k], true, k + ': ' + JSON.stringify(s));
    }
  });

  current = { name: 'C3 diegetic panes', failures: 0 };
  console.log('\n== C3. diegetic panes ==');
  await t('all nine pane fences build their structure', async () => {
    // placard/comms/hud live in the FIRST assistant (msgs[1]); the rest in the LAST (msgs[5])
    const s = await app.ev(`(function () {
      const build = (idx) => {
        const m = document.querySelectorAll('#messages .msg')[idx];
        const d = document.createElement('div');
        d.innerHTML = Constellation.md.render(m.__raw);
        if (window.Constellation.chat.enhanceCodeBlocks) window.Constellation.chat.enhanceCodeBlocks(d);
        return d;
      };
      const d1 = build(1), d5 = build(5);
      const w1 = (sel) => d1.querySelector(sel);
      const w5 = (sel) => d5.querySelector(sel);
      return {
        placard: !!w1('.prose.placard .placard-title'), comms: !!w1('.comms-row .comms-who'),
        hud: !!w1('.hud-row .hud-bar-fill') && !!w1('.hud-chip'),
        note: !!w5('.prose.note .note-sign'), news: !!w5('.news-head .news-mast'),
        diff: !!w5('.diff-add') && !!w5('.diff-del'), verse: !!w5('.prose.verse'),
        memory: !!w5('.prose.dream'), file: !!w5('.codeblock[data-lang="file"]'),
      };
    })()`);
    assert.ok(s.placard && s.note && s.news && s.comms && s.diff && s.hud && s.verse && s.memory && s.file, JSON.stringify(s));
  });
  await t('pane copy source is the exact fence text (wrap.__source invariance)', async () => {
    const s = await app.ev(`(function () {
      const m = document.querySelectorAll('#messages .msg')[5];
      const raw = m.__raw;
      return Array.from(m.querySelectorAll('.codeblock')).map((p) => {
        const src = p.__source || '';
        return { lang: p.dataset.lang || '', len: src.length, exact: src.length > 0 && raw.includes(src.split('\\n')[0]) };
      });
    })()`);
    assert.ok(s.length >= 6, 'panes found: ' + s.length);
    assert.ok(s.every((x) => x.exact), JSON.stringify(s));
  });
  await t('||word|| renders as quiet redaction inside panes; tagged code keeps braces', async () => {
    const s = await app.ev(`(function () {
      const m = document.querySelectorAll('#messages .msg')[5];
      const filePane = m.querySelector('.codeblock[data-lang="file"]');
      const ts = document.createElement('div');
      ts.innerHTML = Constellation.md.render('\\n\\\`\\\`\\\`ts\\nconst a = {{mustStay}};\\n\\\`\\\`\\\`');
      if (window.Constellation.chat.enhanceCodeBlocks) window.Constellation.chat.enhanceCodeBlocks(ts);
      return {
        redactInFile: !!filePane.querySelector('.pp-redact'),
        bracesInCode: ts.textContent.includes('{{mustStay}}'),
        noWhisperInCode: !ts.querySelector('.pp-whisper'),
      };
    })()`);
    assert.equal(s.redactInFile, true, JSON.stringify(s));
    assert.equal(s.bracesInCode, true);
    assert.equal(s.noWhisperInCode, true);
  });
  await t('wide pane: >72-char log line widens + wraps by default without overflow', async () => {
    const s = await app.ev(`(function () {
      const m = document.querySelectorAll('#messages .msg')[5];
      const wide = m.querySelector('.codeblock.wide');
      const pre = wide && wide.querySelector('pre');
      return { wide: !!wide, ws: pre ? getComputedStyle(pre).whiteSpace : null, overflow: pre ? pre.scrollWidth > pre.clientWidth + 2 : null };
    })()`);
    assert.equal(s.wide, true); assert.equal(s.ws, 'pre-wrap'); assert.equal(s.overflow, false);
  });

  current = { name: 'C4 display filters', failures: 0 };
  console.log('\n== C4. display filters ==');
  await t('staged rule renders in the fixture (the reason → the cause)', async () => {
    const s = await app.ev(`(function(){ const m = document.querySelectorAll('#messages .msg')[2]; return m.querySelector('.body').textContent; })()`);
    assert.ok(String(s).includes('the cause'), s);
  });
  await t('toggle off in Settings restores the raw text; 👁 Raw appears when the rule bites', async () => {
    await app.ev(`Constellation.chat.toggleDisplayFilter(0)`, true);
    await sleep(500);
    const after = await app.ev(`({
      raw: document.querySelectorAll('#messages .msg')[2].querySelector('.body').textContent.includes('the reason'),
      btn: !!document.querySelector('#messages [data-action="rawview"]')
    })`);
    assert.equal(after.raw, true); assert.equal(after.btn, true);
    await app.ev(`Constellation.chat.toggleDisplayFilter(0)`, true);
    await sleep(500);
    const back = await app.ev(`document.querySelectorAll('#messages .msg')[2].querySelector('.body').textContent.includes('the cause')`);
    assert.equal(back, true);
  });
  await t('👁 Raw view round-trips', async () => {
    await app.ev(`(function(){ const b = document.querySelector('#messages [data-action="rawview"]'); if (b) b.click(); })()`);
    await sleep(250);
    const raw = await app.ev(`document.querySelectorAll('#messages .msg')[2].querySelector('.body').textContent.includes('the reason')`);
    const btnLabel = await app.ev(`(document.querySelector('#messages [data-action="rawview"]')||{}).textContent`);
    await app.ev(`(function(){ const b = document.querySelector('#messages [data-action="rawview"]'); if (b) b.click(); })()`);
    await sleep(250);
    const filtered = await app.ev(`document.querySelectorAll('#messages .msg')[2].querySelector('.body').textContent.includes('the cause')`);
    assert.equal(raw, true); assert.ok(String(btnLabel).includes('Filtered')); assert.equal(filtered, true);
  });

  current = { name: 'C5 bookmarks', failures: 0 };
  console.log('\n== C5. bookmarks ==');
  await t('rename joins live into the bookmarks overlay', async () => {
    await app.ev(`window.api.renameSession('${FIXTURE_ID}', 'Renamed Fixture')`, true);
    await sleep(600);
    await app.ev(`(function(){ const b = document.getElementById('bookmarksBtn'); if (b) b.click(); })()`);
    await sleep(500);
    const s = await app.ev(`({
      open: document.getElementById('bookmarksOverlay').classList.contains('open'),
      name: (document.querySelector('.bookmark-group-name') || {}).textContent
    })`);
    await app.ev(`(function(){ const o = document.getElementById('bookmarksOverlay'); if (o) o.classList.remove('open'); })()`);
    assert.equal(s.open, true, JSON.stringify(s));
    assert.equal(s.name, 'Renamed Fixture', s.name);
  });
  await t('star jump lands on the bookmarked message', async () => {
    await app.ev(`Constellation.chat.scrollToMessage(1, null)`);
    await sleep(1100);
    const s = await app.ev(`(function () {
      const m = document.querySelectorAll('#messages .msg')[1];
      const r = m.getBoundingClientRect();
      return { inView: r.top > -r.height && r.top < window.innerHeight, flash: m.classList.contains('match-flash') || true };
    })()`);
    assert.equal(s.inView, true);
  });
  await t('toggle round-trips (★ → ☆ → ★)', async () => {
    const s = await app.ev(`(async () => {
      const m = document.querySelectorAll('#messages .msg')[1];
      const btn = m.querySelector('[data-action="bookmark"]');
      btn.click(); await new Promise((r) => setTimeout(r, 450));
      const off = !m.dataset.bookmarked;
      btn.click(); await new Promise((r) => setTimeout(r, 450));
      return { off, backOn: m.dataset.bookmarked === '1' };
    })()`, true);
    assert.equal(s.off, true); assert.equal(s.backOn, true);
  });

  current = { name: 'C6 model stamps + popover + persist survival', failures: 0 };
  console.log('\n== C6. model stamps + persist ==');
  await t('send through the mock: reply stamped + popover opens', async () => {
    await app.ev(`(function(){ const m = document.getElementById('messages'); m.scrollTop = m.scrollHeight; })()`);
    await app.ev(`(function(){ document.getElementById('input').value = 'e2e stamp probe'; document.getElementById('send').click(); })()`);
    for (let i = 0; i < 60; i++) { const busy = await app.ev(`document.getElementById('send').classList.contains('stop')`); if (busy) break; await sleep(150); }
    for (let i = 0; i < 60; i++) { const d = await app.ev(`!document.getElementById('send').classList.contains('stop')`); if (d) break; await sleep(150); }
    await sleep(1500);
    const s = await app.ev(`(function () {
      const ms = document.querySelectorAll('#messages .msg');
      const last = ms[ms.length - 1];
      const tag = last.querySelector('.model-tag');
      if (tag) tag.click();
      return { tag: tag ? tag.textContent : null, pop: !!document.querySelector('.model-pop'), rows: document.querySelectorAll('.model-pop .model-row').length };
    })()`);
    assert.ok(String(s.tag).includes('mock-1'), JSON.stringify(s));
    assert.equal(s.pop, true); assert.ok(s.rows >= 1);
    await app.ev(`(function(){ const p = document.querySelector('.model-pop'); if (p) p.remove(); })()`);
  });
  await t('persist() 12-arg survival: cast metadata + re-injection survive a send to disk', async () => {
    const diskPath = path.join(PROFILE, 'data', 'sessions', FIXTURE_ID + '.json');
    const disk = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
    assert.equal(disk.character && disk.character.id, 'e2e-char-000', 'character kept');
    assert.equal(disk.cardReinject, 3, 'cardReinject kept');
    assert.equal(disk.cardReinjectAt, 5000, 'cardReinjectAt kept');
    assert.ok(String(disk.cardBlock || '').includes('E2E CARD BLOCK'), 'cardBlock kept');
    assert.equal(disk.projectFence, 'project_instructions', 'projectFence kept');
    assert.ok(disk.messages.length >= 8, 'send appended: ' + disk.messages.length);
  });
  await t('reload from disk renders the persisted chat cleanly', async () => {
    const errs = app.events.length;
    await app.ev(`Constellation.sessions.load('${FIXTURE_ID}')`, true);
    await sleep(1200);
    const count = await app.ev(`document.querySelectorAll('#messages .msg').length`);
    const thrown = app.events.slice(errs).filter((e) => e.method === 'Runtime.exceptionThrown');
    assert.ok(count >= 8, 'count ' + count);
    assert.deepEqual(thrown, []);
  });

  current = { name: 'C7 streaming', failures: 0 };
  console.log('\n== C7. streaming (mock-server scenarios) ==');
  await t('pinned follow: zero bounce while the reader sits at the bottom', async () => {
    await app.ev(`(function(){ document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight; })()`);
    await app.ev(`(function(){ document.getElementById('input').value = 'SLOWDRAG pinned'; document.getElementById('send').click(); })()`);
    let worst = 0;
    for (let i = 0; i < 8; i++) {
      await sleep(320);
      const s = await app.ev(`(function () { const m = document.getElementById('messages'); return { gap: m.scrollHeight - m.scrollTop - m.clientHeight, busy: document.getElementById('send').classList.contains('stop') }; })()`);
      worst = Math.max(worst, s.gap);
      if (!s.busy && i > 2) break;
    }
    assert.ok(worst <= 120, 'worst bottom gap ' + worst + 'px');
    for (let i = 0; i < 200; i++) { const d = await app.ev(`!document.getElementById('send').classList.contains('stop')`); if (d) break; await sleep(150); }
    await sleep(2500);
  });
  await t('mid-drain scrolled-up: hands-off hold + jump button, no snap', async () => {
    await app.ev(`(function(){ document.getElementById('input').value = 'SLOWDRAG anchor'; document.getElementById('send').click(); })()`);
    let busy = false;
    for (let i = 0; i < 40; i++) { busy = await app.ev(`document.getElementById('send').classList.contains('stop')`); if (busy) break; await sleep(100); }
    await sleep(700);
    await app.ev(`(function(){ const m = document.getElementById('messages'); m.scrollTop = Math.max(0, m.scrollTop - 700); })()`);
    const upTop = await app.ev(`document.getElementById('messages').scrollTop`);
    await sleep(1100);
    const s = await app.ev(`({ top: document.getElementById('messages').scrollTop, jump: !document.getElementById('jumpBottom').hidden })`);
    assert.ok(Math.abs(s.top - upTop) < 60, 'scrollTop held: ' + upTop + ' → ' + s.top);
    assert.equal(s.jump, true);
    await app.ev(`(function(){ document.getElementById('jumpBottom').click(); })()`);
    await sleep(400);
    for (let i = 0; i < 200; i++) { const d = await app.ev(`!document.getElementById('send').classList.contains('stop')`); if (d) break; await sleep(150); }
    await sleep(2500);
  });
  await t('streaming ink wraps the tail mid-stream and cleans at finish', async () => {
    await app.ev(`(function(){ document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight; })()`);
    await app.ev(`(function(){ document.getElementById('input').value = 'SLOWDRAG ink'; document.getElementById('send').click(); })()`);
    let maxTok = 0;
    for (let i = 0; i < 12; i++) {
      const c = await app.ev(`document.querySelectorAll('#messages .msg:last-child .tok-in').length`);
      maxTok = Math.max(maxTok, c);
      await sleep(300);
      const busy = await app.ev(`document.getElementById('send').classList.contains('stop')`);
      if (!busy && i > 2) break;
    }
    for (let i = 0; i < 200; i++) { const d = await app.ev(`!document.getElementById('send').classList.contains('stop')`); if (d) break; await sleep(150); }
    // the reveal drain continues after busy clears — wait for it before asserting cleanup
    let prev = -1;
    for (let i = 0; i < 150; i++) {
      const st = await app.ev(`(function(){ const b = document.querySelector('#messages .msg:last-child .body'); return { caret: !!(b && b.classList.contains('caret')), len: b ? b.textContent.length : 0 }; })()`);
      if (!st.caret && st.len === prev && st.len > 50) break;
      prev = st.len;
      await sleep(200);
    }
    const end = await app.ev(`document.querySelectorAll('#messages .msg:last-child .tok-in').length`);
    assert.ok(maxTok > 0, 'mid-stream tok-in max ' + maxTok);
    assert.equal(end, 0);
  });
  await t('Stop keeps the partial and never hangs the prompt box', async () => {
    await app.ev(`(function(){ document.getElementById('input').value = 'SLOWDRAG stop'; document.getElementById('send').click(); })()`);
    let busy = false;
    for (let i = 0; i < 40; i++) { busy = await app.ev(`document.getElementById('send').classList.contains('stop')`); if (busy) break; await sleep(100); }
    await sleep(900);
    await app.ev(`(function(){ document.getElementById('send').click(); })()`);
    let stopped = false;
    for (let i = 0; i < 20; i++) { stopped = await app.ev(`!document.getElementById('send').classList.contains('stop')`); if (stopped) break; await sleep(150); }
    await sleep(800);
    const s = await app.ev(`({ len: (function(){ const ms = document.querySelectorAll('#messages .msg'); const b = ms[ms.length-1].querySelector('.body'); return b ? b.textContent.length : 0; })(), inputEnabled: !document.getElementById('input').disabled })`);
    assert.equal(stopped, true);
    assert.ok(s.len > 40, 'partial kept: ' + s.len);
    assert.equal(s.inputEnabled, true);
  });
  await t('THINKFOLD: thinking opens live and folds inside the measured finish window', async () => {
    await app.ev(`(function(){ document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight; })()`);
    await app.ev(`(function(){ document.getElementById('input').value = 'THINKFOLD fold probe'; document.getElementById('send').click(); })()`);
    let sawOpen = false;
    for (let i = 0; i < 40; i++) {
      const s = await app.ev(`(function(){ const b = document.querySelector('#messages .msg:last-child .think-block'); return b ? { open: b.open, hidden: b.hidden } : null; })()`);
      if (s && s.open && !s.hidden) sawOpen = true;
      const busy = await app.ev(`document.getElementById('send').classList.contains('stop')`);
      if (!busy && i > 3) break;
      await sleep(180);
    }
    for (let i = 0; i < 120; i++) { const d = await app.ev(`!document.getElementById('send').classList.contains('stop')`); if (d) break; await sleep(150); }
    await sleep(900);
    const end = await app.ev(`(function(){ const b = document.querySelector('#messages .msg:last-child .think-block'); return { open: b ? b.open : null }; })()`);
    assert.equal(sawOpen, true);
    assert.equal(end.open, false, 'folded at finish');
  });
  await t('edit-in-place (Save in place) swaps the body without resending', async () => {
    const before = await app.ev(`document.querySelectorAll('#messages .msg').length`);
    await app.ev(`(function(){ const ms = document.querySelectorAll('#messages .msg'); const last = ms[ms.length-1]; const edit = last && last.previousElementSibling ? last.previousElementSibling.querySelector('[data-action="edit"]') : null; if (edit) edit.click(); })()`);
    await sleep(350);
    await app.ev(`(function () {
      const area = document.querySelector('#messages textarea, #messages .edit-area');
      if (!area) throw new Error('no edit area');
      area.value = 'edited in place by e2e';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = document.querySelector('#messages [data-action="commit-inplace"]');
      if (!btn) throw new Error('no save-in-place btn');
      btn.click();
    })()`);
    await sleep(700);
    const after = await app.ev(`({ n: document.querySelectorAll('#messages .msg').length, swapped: (function(){ const ms = document.querySelectorAll('#messages .msg'); for (const m of ms) { const b = m.querySelector('.body'); if (b && b.textContent.includes('edited in place by e2e')) return true; } return false; })() })`);
    assert.equal(after.n, before, 'no message added: ' + before + ' → ' + after.n);
    assert.equal(after.swapped, true, 'visible body swapped');
    // Save-in-place persists — the DISK conversation carries the new content (KNOWN BUG
    // tracked in the Phase 4 report: el.__raw keeps the stale pre-edit text until reload)
    const disk = JSON.parse(fs.readFileSync(path.join(PROFILE, 'data', 'sessions', FIXTURE_ID + '.json'), 'utf8'));
    assert.ok(disk.messages.some((m) => (m.content || '').includes('edited in place by e2e')), 'persisted');
  });
  await t('hold-to-resend: cutting resend fires after the 0.7s hold', async () => {
    const before = await app.ev(`document.querySelectorAll('#messages .msg').length`);
    // edit the FIRST user message (later messages exist → cutCount > 0 → hold-confirm)
    await app.ev(`(function(){ document.querySelector('#messages .msg [data-action="edit"]').click(); })()`);
    await sleep(350);
    await app.ev(`(function () {
      const area = document.querySelector('#messages textarea, #messages .edit-area');
      if (!area) throw new Error('no edit area');
      area.value = 'held resend by e2e';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = document.querySelector('#messages [data-action="commit"]');
      if (!btn) throw new Error('no commit btn');
      if (!btn.classList.contains('hold-confirm')) throw new Error('hold-confirm variant absent (cutCount 0?)');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      setTimeout(() => { btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, 950);   // past the 0.7s confirm hold
    })()`);
    let busy = false;
    for (let i = 0; i < 40; i++) { busy = await app.ev(`document.getElementById('send').classList.contains('stop')`); if (busy) break; await sleep(150); }
    for (let i = 0; i < 60; i++) { const d = await app.ev(`!document.getElementById('send').classList.contains('stop')`); if (d) break; await sleep(150); }
    await sleep(1200);
    // "Save & resend · cuts N" DELETES the later messages by design — the conversation is
    // truncated to the edited turn, then the fresh user+assistant pair appends. Count 2.
    const after = await app.ev(`document.querySelectorAll('#messages .msg').length`);
    const disk = JSON.parse(fs.readFileSync(path.join(PROFILE, 'data', 'sessions', FIXTURE_ID + '.json'), 'utf8'));
    const lastUser = [...disk.messages].reverse().find((m) => m.role === 'user');
    assert.equal(after, 2, 'cut-resend truncates to the edited turn + fresh reply (was ' + before + ')');
    assert.ok((lastUser.content || '').includes('held resend by e2e'), 'edited text is the new conversation head');
  });

  current = { name: 'C8 audio wire + appearance preview', failures: 0 };
  console.log('\n== C8. audio wire + appearance preview ==');
  await t('input_audio wire part built by the real compose path', async () => {
    const s = await app.ev(`(function () {
      const out = Constellation.chat.testCompose([
        { role: 'system', content: 's' },
        { role: 'user', content: 'hear this', files: [{ name: 'a.wav', kind: 'audio', dataUrl: ${JSON.stringify(TINY_WAV)} }] },
      ]);
      const last = out[out.length - 1];
      const part = Array.isArray(last.content) && last.content.find((p) => p.type === 'input_audio');
      return { isArr: Array.isArray(last.content), format: part && part.input_audio.format, hasData: !!(part && part.input_audio.data && part.input_audio.data.length) };
    })()`);
    assert.equal(s.isArr, true); assert.equal(s.format, 'wav'); assert.equal(s.hasData, true);
  });
  await t('appearance live preview renders through the real pipeline and follows voice changes', async () => {
    const s = await app.ev(`(function () {
      const host = document.getElementById('appearancePreview');
      const before = host ? host.innerHTML.length : -1;
      const sel = document.getElementById('dialogueStyleInput');
      if (sel) { sel.value = 'noir'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      const after = host ? host.innerHTML.length : -1;
      return { exists: !!host, before, after, noirOn: document.body.classList.contains('dlg-noir') };
    })()`);
    assert.equal(s.exists, true, JSON.stringify(s));
    assert.equal(s.noirOn, true);
    assert.ok(s.after > 0, 'preview populated');
    await app.ev(`(function(){ const sel = document.getElementById('dialogueStyleInput'); if (sel) { sel.value = 'chiaroscuro'; sel.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  });

// ---------------- error budget ----------------
current = { name: 'D global error budget', failures: 0 };
const thrownAll = app.events.filter((e) => e.method === 'Runtime.exceptionThrown');
record('zero uncaught exceptions across the whole run', thrownAll.length === 0, thrownAll.slice(0, 3).map((x) => JSON.stringify(x.params).slice(0, 150)).join(' | '));
const consoleErrs = app.events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
record('zero console.error across the whole run', consoleErrs.length === 0, consoleErrs.slice(0, 3).map((x) => (x.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 140)).join(' | '));
} catch (e) {
  fatal = e;
  console.log('\nFATAL (suite aborted): ' + e.message);
}

// ---------------- teardown ----------------
console.log('\n== teardown ==');
await app.kill();
try { mock.child.kill(); } catch (e) {}
await sleep(400);
let cleaned = false;
for (let i = 0; i < 4; i++) {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); cleaned = true; break; }
  catch (e) { await sleep(1000); }
}
console.log(cleaned ? 'profile deleted' : 'profile cleanup skipped (locked — disposable, removed next run)');

const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log('\n== SUMMARY ==');
if (fail) for (const r of results.filter((r) => !r.ok)) console.log('  FAIL [' + r.suite + '] ' + r.name + (r.detail ? ' — ' + r.detail : ''));
console.log((fatal ? 'ABORTED — ' : '') + pass + ' passed, ' + fail + ' failed' + (fail ? '' : ' — ALL GREEN'));
process.exit(fatal || fail ? 1 : 0);
