// chaos runner — resilience against hostile/corrupt inputs, against a disposable profile
// (tests/.chaos-profile, gitignored) and dedicated ports (CLI 7334, hostile mock 7392,
// CDP 9234). Produces a classified report: DEFENDED vs FINDINGS.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { launchApp, sleep } from '../helpers/electron.mjs';
import M from '../../src/js/mainutil.js';
import cardcompile from '../../src/js/cardcompile.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PROFILE = path.resolve(HERE, '..', '.chaos-profile');
const CHAOS_MOCK_PORT = 7392;
const results = [];      // { suite, name, ok, finding? }
const findings = [];     // { title, file, detail, repro, fix }
let current = { name: '(setup)' };

function record(name, ok, detail) {
  results.push({ suite: current.name, name, ok, detail: detail == null ? '' : String(detail).slice(0, 200) });
  console.log((ok ? '  ✔ DEFENDED  ' : '  ✖ PROBLEM   ') + name + (detail ? ' — ' + String(detail).slice(0, 150) : ''));
}
function finding(title, file, detail, repro, fix) {
  findings.push({ title, file, detail, repro, fix });
  console.log('  ⚠ FINDING: ' + title);
}
async function t(name, fn) { try { await fn(); record(name, true); } catch (e) { record(name, false, e.message); } }

// ---------- stage the hostile profile ----------
fs.rmSync(PROFILE, { recursive: true, force: true });
const config = path.join(PROFILE, 'config');
const data = path.join(PROFILE, 'data');
fs.mkdirSync(path.join(config, 'modes'), { recursive: true });
fs.mkdirSync(path.join(data, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(PROFILE, 'data', 'characters'), { recursive: true });

fs.writeFileSync(path.join(config, 'connections.json'), JSON.stringify({
  active: 'c_mock',
  list: [{ id: 'c_mock', name: 'Chaos Mock', baseUrl: `http://127.0.0.1:${CHAOS_MOCK_PORT}/v1`, models: [{ id: 'mock-1', label: 'Mock' }], activeModel: 'mock-1' }],
}, null, 2), 'utf8');
fs.writeFileSync(path.join(config, 'settings.txt'), 'model: mock-1\nbase_url: http://127.0.0.1:' + CHAOS_MOCK_PORT + '/v1\nstream_cps: 400\nthinking: off\n', 'utf8');
// display-filter whose REPLACEMENT is itself an injection vector
fs.writeFileSync(path.join(config, 'display-filters.txt'), '/TRIGGERWORD/ => <img src=x onerror="window.__pwned=(window.__pwned||0)+1">\n', 'utf8');

// a normal chat + a chat whose projectFence is an injection vector
fs.writeFileSync(path.join(data, 'sessions', 'chaosmain.json'), JSON.stringify({
  id: 'chaosmain', title: 'chaos main', messages: [
    { role: 'user', content: 'Start the scene.' },
    { role: 'assistant', content: 'The lamp buzzed.', model: 'mock-1' },
    { role: 'user', content: 'Now say TRIGGERWORD plainly.' },
  ],
  gen: { model: 'mock-1', streamCps: 400 }, usage: { tokens: 10, requests: 1 },
  projectFence: '<img src=x onerror="window.__pwned=(window.__pwned||0)+1">',
}, null, 2), 'utf8');
fs.writeFileSync(path.join(data, 'sessions', 'chaossmall.json'), JSON.stringify({
  id: 'chaossmall', title: 'chaos small', messages: [{ role: 'user', content: 'small' }, { role: 'assistant', content: 'small reply', model: 'mock-1' }],
  gen: { model: 'mock-1' },
}, null, 2), 'utf8');

// corrupt session files at boot: truncated JSON, empty file, wrong shape, hostile fence id
fs.writeFileSync(path.join(data, 'sessions', 'corrupt_truncated.json'), '{"id": "corrupt_truncated", "title": "trunc", "messages": [{"role": "user", content: broken', 'utf8');
fs.writeFileSync(path.join(data, 'sessions', 'corrupt_empty.json'), '', 'utf8');
fs.writeFileSync(path.join(data, 'sessions', 'corrupt_shape.json'), '[1, 2, 3]', 'utf8');

// hostile lorebook + chronicle + card
fs.writeFileSync(path.join(data, 'lorebooks.json'), JSON.stringify({
  lb_chaos: { id: 'lb_chaos', name: 'Chaos book <img src=x onerror=pwn()>', entries: [
    { id: 'e1', enabled: true, keys: ['trigger'], content: '<img src=x onerror="window.__pwned=(window.__pwned||0)+1"> lore body [[pickup]]' },
  ] },
}), 'utf8');
fs.writeFileSync(path.join(data, 'chronicle.json'), JSON.stringify({
  chaosmain: { facts: [{ t: '<svg onload="window.__pwned=(window.__pwned||0)+1"></svg> hostile fact', kind: 'note' }], seen: 3, summary: '', sumSeen: 0 },
}), 'utf8');
fs.writeFileSync(path.join(PROFILE, 'data', 'characters', 'chaoschar.json'), JSON.stringify({
  id: 'c_chaos', name: 'Chaos <b>Card</b>', description: '<img src=x onerror="window.__pwned=(window.__pwned||0)+1"> <script>window.__pwned=(window.__pwned||0)+1;</script> [click](javascript:window.__pwned=(window.__pwned||0)+1) <iframe src="javascript:window.__pwned=(window.__pwned||0)+1"></iframe>',
  personality: '', scenario: '', mesExample: '', tags: [], creator: '', avatar: '',
  characterBook: { entries: [{ keys: ['trigger'], content: '<script>window.__pwned=(window.__pwned||0)+1;</script> book body' }] },
}, null, 2), 'utf8');

// ---------- Section 0: pure-Node hostile inputs (no app) ----------
current = { name: '0 pure-Node hostile inputs' };
console.log('\n== 0. pure-Node hostile inputs ==');

await t('zTXt decompression bomb: inflateSync caps output against a hostile compressed chunk', async () => {
  // 64MB of zeros deflate to ~62KB — a hand-crafted card PNG can carry this in one chunk.
  // Detection: heap delta across the call. The downstream JSON.parse fails either way —
  // the vulnerability is the UNCAPPED ALLOCATION itself (main-process DoS).
  const bombRaw = Buffer.alloc(64 * 1024 * 1024, 0);
  const small = zlib.deflateSync(bombRaw);
  const data = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from([0]), small]);
  const buf = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    (() => { const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); out.write('zTXt', 4, 'ascii'); data.copy(out, 8); return out; })(),
    (() => { const out = Buffer.alloc(12); out.writeUInt32BE(0, 0); out.write('IEND', 4, 'ascii'); return out; })(),
  ]);
  const t0 = Date.now();
  let result = null, threw = null;
  try { result = M.extractCardFromPng(buf); } catch (e) { threw = e; }
  const ms = Date.now() - t0;
  // deterministic cap check: does zlib inflate the SAME payload beyond any cap when called
  // the way the app calls it (no maxOutputLength)? The downstream JSON.parse failing does
  // NOT undo the allocation — the vulnerability is the uncapped inflate itself.
  let inflated = 0;
  try { inflated = zlib.inflateSync(small).length; } catch (e) {}
  if (threw && / allocation|maxOutput/i.test(threw.message)) { record('bomb rejected by an output cap', true, threw.message.slice(0, 80)); return; }
  if (inflated >= bombRaw.length) {
    record('bomb inflated WITHOUT a cap (uncapped main-process allocation)', false, Math.round(small.length / 1024) + 'KB → ' + Math.round(inflated / 1048576) + 'MB in ' + ms + 'ms (parse then failed, allocation already made)');
    finding(
      'PNG zTXt decompression bomb — inflateSync has no output cap',
      'src/js/mainutil.js — extractCardFromPng, the zTXt branch (zlib.inflateSync)',
      'A crafted .png card (~62KB compressed) inflates to 64MB+ inside the MAIN process at import; a multi-GB chunk freezes or OOMs the app before the downstream JSON.parse fails. zlib supports maxOutputLength — the call does not use it.',
      'tests/chaos/run.mjs → "zTXt decompression bomb" (pure-Node, direct-inflate proof)',
      'inflateSync(data, { maxOutputLength: 4 * 1024 * 1024 }) in a try/catch — over the cap throws, the import fails cleanly.',
    );
  } else {
    record('bomb capped or rejected', true, 'ms=' + ms + (threw ? '; threw: ' + threw.message.slice(0, 60) : ''));
  }
});

await t('corrupt/truncated/non-PNG card files fail cleanly through the parser', () => {
  assert.equal(M.extractCardFromPng(Buffer.from('definitely not a png, long enough to pass the length guard')), null);
  assert.equal(M.extractCardFromPng(PNG_SIG_ONLY()), null);
  assert.equal(M.extractCardFromPng(Buffer.alloc(0)), null);
});
function PNG_SIG_ONLY() { return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); }

await t('prototype-pollution keys in card JSON cannot tamper Object.prototype', () => {
  const hostile = JSON.parse('{"data": {"name": "P", "description": "x", "__proto__": {"polluted": "yes"}}, "constructor": {"prototype": {"polluted2": "yes"}}}');
  const n = M.normalizeCard(hostile);
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).polluted2, undefined);
  assert.equal(n.name, 'P');
  const lb = cardcompile.bookToLore({ name: 'x', characterBook: { entries: [{ keys: [], content: 'c', __proto__: { evil: 1 } }] } });
  assert.equal(({}).evil, undefined);
  assert.ok(lb && lb.entries.length === 1);
});

// ---------- spawn hostile mock + app ----------
function spawnChaosMock() {
  const child = spawn(process.execPath, [path.join(HERE, 'mock-hostile.mjs')], { env: Object.assign({}, process.env, { CHAOS_MOCK_PORT: String(CHAOS_MOCK_PORT) }), stdio: 'ignore' });
  return { child, port: CHAOS_MOCK_PORT };
}

console.log('\n== spawning hostile mock on 7392 and app on CDP 9234 ==');
const mock = spawnChaosMock();
// health-wait the mock
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CHAOS_MOCK_PORT}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'health' }] }), signal: AbortSignal.timeout(1500) }); if (r.ok) break; } catch (e) { await sleep(200); }
}
const app = await launchApp({ userData: PROFILE, cliPort: 7334, cdpPort: 9234 });

// page-side execution trap: any injected handler that survives sanitization increments __pwned
await app.ev(`window.__pwned = 0; window.pwn = function () { window.__pwned = (window.__pwned || 0) + 1; }; window.alert = function () { window.__pwned = (window.__pwned || 0) + 1; return ''; }; true`);
// stage a dummy vault key — the send gate rejects keyless connections BEFORE the wire,
// which would make every network-chaos scenario vacuous
await app.ev(`window.api.saveConnections({ active: 'c_mock', list: [{ id: 'c_mock', name: 'Chaos Mock', baseUrl: 'http://127.0.0.1:7392/v1', models: [{ id: 'mock-1', label: 'Mock' }], activeModel: 'mock-1' }], keyUpdates: [{ connId: 'c_mock', key: 'chaos-dummy-key' }] })`, true);

let fatal = null;
try {
  // ---------- Section 1: corrupt profile at boot ----------
  current = { name: '1 corrupt profile at boot' };
  console.log('\n== 1. corrupt profile at boot ==');
  await sleep(2500);
  await t('boot survives corrupt session files (truncated / empty skipped; wrong shape → FINDING)', async () => {
    const s = await app.ev(`(async () => ({
      booted: !!(window.Constellation && window.Constellation.chat),
      listed: (await window.api.listSessions()).map((x) => x.id).sort(),
    }))()`, true);
    assert.ok(s.booted, JSON.stringify(s));
    assert.ok(!s.listed.includes('corrupt_truncated') && !s.listed.includes('corrupt_empty'), 'truncated/empty skipped: ' + JSON.stringify(s.listed));
    if (s.listed.includes('corrupt_shape')) {
      finding(
        'Parseable-but-wrong-shape session JSON becomes a phantom sidebar chat',
        'main.js — sessions:list (row builder) and sessions:load (no plain-object guard)',
        'A session file containing valid JSON of the wrong shape ([1,2,3]) parses fine, so it appears in the sidebar as an empty chat with an undefined id; loading it hands the renderer undefined id fields.',
        'tests/chaos/run.mjs stages data/sessions/corrupt_shape.json = "[1, 2, 3]" → boot → sessions:list includes corrupt_shape',
        'In sessions:list, skip rows where the parsed file is not a plain object (Array.isArray(d) || d === null), and give sessions:load the same guard before reading d.messages.',
      );
      record('wrong-shape JSON creates a phantom entry (finding recorded)', false, JSON.stringify(s.listed));
    } else {
      record('wrong-shape JSON skipped', true);
    }
  });
  await t('loading a corrupt id falls back to a clean empty session', async () => {
    const s = await app.ev(`window.api.loadSession('corrupt_truncated').then((d) => ({ id: d.id, msgs: (d.messages || []).length }))`, true);
    assert.equal(s.msgs, 0);
  });
  await t('path-traversal ids are rejected by the IPC layer', async () => {
    const s = await app.ev(`Promise.all([
      window.api.loadSession('../../etc/passwd').then((d) => d.id),
      window.api.loadSession('..%2F..%2Fetc').then((d) => d.id),
      window.api.loadSession('..\\\\windows\\\\temp').then((d) => d.id),
    ])`, true);
    assert.deepEqual(s, [null, null, null], JSON.stringify(s));
  });
  await t('hostile projectFence (<img onerror>) falls back to the safe default tag', async () => {
    const s = await app.ev(`Constellation.chat.getPrompts().projectFenceTag`);
    assert.equal(s, 'project_instructions');
  });
  await t('hostile fence never executes (trap stays zero)', async () => {
    const s = await app.ev(`window.__pwned`);
    assert.equal(s, 0);
  });

  // ---------- Section 2: injection rendering ----------
  current = { name: '2 injection rendering' };
  console.log('\n== 2. injection rendering ==');
  await t('hostile prose: on*/script/iframe/javascript: all stripped by the render pipeline', async () => {
    const s = await app.ev(`(function () {
      const hostile = '<img src=x onerror="window.pwn()"><svg onload="window.pwn()"><script>window.pwn()</script><iframe src="javascript:window.pwn()"></iframe><a href="javascript:window.pwn()">x</a>';
      const d = document.createElement('div');
      d.innerHTML = window.Constellation.md.render(hostile);
      if (window.Constellation.chat.enhanceCodeBlocks) window.Constellation.chat.enhanceCodeBlocks(d);
      return {
        script: !!d.querySelector('script'), iframe: !!d.querySelector('iframe'),
        onErr: !!d.querySelector('[onerror]'), onLoad: !!d.querySelector('[onload]'),
        jsHref: !!d.querySelector('a[href^="javascript"]'), pwned: window.__pwned,
      };
    })()`);
    assert.equal(s.script, false, JSON.stringify(s));
    assert.equal(s.iframe, false);
    assert.equal(s.onErr, false);
    assert.equal(s.onLoad, false);
    assert.equal(s.jsHref, false);
    assert.equal(s.pwned, 0);
  });
  await t('display-filter REPLACEMENT injection is sanitized at render', async () => {
    await app.ev(`Constellation.sessions.load('chaosmain')`, true);
    await sleep(900);
    const s = await app.ev(`({
      pwned: window.__pwned,
      onErr: !!document.querySelector('#messages [onerror]'),
      imgs: document.querySelectorAll('#messages .body img[src="x"]').length,
      text: document.querySelector('#messages .body').textContent.includes('TRIGGERWORD') === false
    })`);
    assert.equal(s.pwned, 0, JSON.stringify(s));
    assert.equal(s.onErr, false);
  });
  await t('hostile card detail view (Cast) renders sanitized', async () => {
    await app.ev(`(function(){ const b = document.getElementById('castBtn'); if (b) b.click(); })()`);
    await sleep(700);
    await app.ev(`(function(){ const card = document.querySelector('.cast-card'); if (card) card.click(); })()`);
    await sleep(600);
    const s = await app.ev(`({
      pwned: window.__pwned,
      script: !!document.querySelector('.cast-overlay script'),
      onErr: !!document.querySelector('.cast-overlay [onerror]'),
      jsLink: !!document.querySelector('.cast-overlay a[href^="javascript"]'),
      overlay: !!document.querySelector('.cast-overlay'),
    })`);
    await app.ev(`(function(){ const o = document.querySelector('.cast-overlay'); if (o) o.remove(); })()`);
    assert.equal(s.overlay, true, JSON.stringify(s));
    assert.equal(s.pwned, 0);
    assert.equal(s.script, false); assert.equal(s.onErr, false); assert.equal(s.jsLink, false);
  });
  await t('hostile lorebook + chronicle render without execution', async () => {
    await app.ev(`Constellation.sessions.setLore(['lb_chaos'])`, true);
    await sleep(500);
    await app.ev(`Constellation.chronicle.setChat ? Constellation.chronicle.setChat('chaosmain', null) : null`);
    await sleep(400);
    const s = await app.ev(`({ pwned: window.__pwned, onErr: !!document.querySelector('#messages [onerror], .chronicle-panel [onerror]') })`);
    assert.equal(s.pwned, 0, JSON.stringify(s));
    assert.equal(s.onErr, false);
  });

  // ---------- Section 3: malformed files through real IPC ----------
  current = { name: '3 malformed files via IPC' };
  console.log('\n== 3. malformed files via IPC ==');
  await t('non-PNG renamed .png fails the import cleanly', async () => {
    const p = path.join(PROFILE, 'notapng.png');
    fs.writeFileSync(p, Buffer.from('this is not a png at all, just text pretending'));
    const r = await app.ev(`window.api.importCharacterFiles([${JSON.stringify(p)}]).then((x) => x[0])`, true);
    assert.equal(r.ok, false, JSON.stringify(r));
  });
  await t('malformed card JSON (no name) fails cleanly', async () => {
    const p = path.join(PROFILE, 'noname.json');
    fs.writeFileSync(p, JSON.stringify({ data: { description: 'no name here' } }));
    const r = await app.ev(`window.api.importCharacterFiles([${JSON.stringify(p)}]).then((x) => x[0])`, true);
    assert.equal(r.ok, false, JSON.stringify(r));
  });
  await t('>15MB audio is rejected by the intake cap', async () => {
    const r = await app.ev(`(async () => {
      window.__chipCountBefore = document.querySelectorAll('#attachments .attach-chip').length;
      const big = new Uint8Array(16 * 1024 * 1024);
      const file = new File([big], 'huge.wav', { type: 'audio/wav' });
      const dt = new DataTransfer(); dt.items.add(file);
      const drop = new DragEvent('drop', { bubbles: true, dataTransfer: dt });
      document.getElementById('input').dispatchEvent(drop);
      await new Promise((r) => setTimeout(r, 900));
      return { chips: document.querySelectorAll('#attachments .attach-chip').length, toast: (document.querySelector('.toast') || {}).textContent || '' };
    })()`, true);
    assert.equal(r.chips, 0, JSON.stringify({ chips: r.chips, toast: r.toast }));
    assert.ok(String(r.toast).toLowerCase().includes('15mb'), 'toast names the cap: ' + r.toast);
  });

  // ---------- Section 4: hostile network ----------
  current = { name: '4 hostile network' };
  console.log('\n== 4. hostile network (hostile mock 7392) ==');
  async function sendScenario(label) {
    await app.ev(`(function(){ const m = document.getElementById('messages'); if (m) m.scrollTop = m.scrollHeight; })()`);
    await app.ev(`(function(){ document.getElementById('input').value = '${label} chaos'; document.getElementById('send').click(); })()`);
    let busy = false;
    for (let i = 0; i < 30; i++) { busy = await app.ev(`document.getElementById('send').classList.contains('stop')`); if (busy) break; await sleep(120); }
    return busy;
  }
  async function waitSettled(maxMs) {
    for (let i = 0; i < Math.ceil((maxMs || 30000) / 150); i++) {
      const d = await app.ev(`!document.getElementById('send').classList.contains('stop')`);
      if (d) return true;
      await sleep(150);
    }
    return false;
  }
  await t('TCP drop mid-SSE: error surfaces, UI recovers, disk intact', async () => {
    const diskBefore = JSON.parse(fs.readFileSync(path.join(PROFILE, 'data', 'sessions', 'chaosmain.json'), 'utf8')).messages.length;
    assert.equal(await sendScenario('DROP'), true, 'went busy');
    const settled = await waitSettled(15000);
    await sleep(600);
    const s = await app.ev(`({ status: (document.getElementById('status')||{textContent:''}).textContent, cls: (document.getElementById('status')||{className:''}).className, input: !document.getElementById('input').disabled, pwned: window.__pwned })`);
    const diskAfter = JSON.parse(fs.readFileSync(path.join(PROFILE, 'data', 'sessions', 'chaosmain.json'), 'utf8')).messages.length;
    assert.equal(settled, true, 'busy cleared');
    assert.ok(String(s.cls).includes('err'), 'error surfaced in the status pill: ' + s.status);
    assert.equal(s.input, true);
    assert.equal(s.pwned, 0);
    // a mid-stream ERROR discards the partial by design (persist-on-fail was declined) —
    // the on-disk chat must be UNCHANGED, never torn
    assert.equal(diskAfter, diskBefore, 'disk unchanged: ' + diskBefore + ' → ' + diskAfter);
  });
  await t('malformed SSE frames: valid bits still land, stream completes, no crash', async () => {
    assert.equal(await sendScenario('BADSSE'), true);
    assert.equal(await waitSettled(15000), true);
    await sleep(500);
    const s = await app.ev(`({ lastLen: (function(){ const ms = document.querySelectorAll('#messages .msg'); const b = ms[ms.length-1].querySelector('.body'); return b ? b.textContent.length : 0; })(), pwned: window.__pwned })`);
    assert.ok(s.lastLen > 0, 'the valid bit after the junk arrived: ' + s.lastLen);
    assert.equal(s.pwned, 0);
  });
  await t('HTTP 401: clean error, no retry storm', async () => {
    assert.equal(await sendScenario('E401'), true);
    assert.equal(await waitSettled(15000), true);
    const s = await app.ev(`({ status: (document.getElementById('status')||{textContent:''}).textContent, cls: (document.getElementById('status')||{className:''}).className })`);
    assert.ok(String(s.cls).includes('err'), JSON.stringify(s));
  });
  await t('HTTP 429 + 500: retries exhaust, error surfaces, UI recovers', async () => {
    assert.equal(await sendScenario('E429'), true);
    assert.equal(await waitSettled(30000), true);
    assert.equal(await sendScenario('E500'), true);
    assert.equal(await waitSettled(30000), true);
    const s = await app.ev(`({ input: !document.getElementById('input').disabled, pwned: window.__pwned })`);
    assert.equal(s.input, true); assert.equal(s.pwned, 0);
  });
  await t('empty choices:[] stream completes as a normal (empty) reply, no crash', async () => {
    assert.equal(await sendScenario('EMPTYCHOICES'), true);
    assert.equal(await waitSettled(15000), true);
    const s = await app.ev(`window.__pwned`);
    assert.equal(s, 0);
  });

  // ---------- Section 5: UI races ----------
  current = { name: '5 UI races' };
  console.log('\n== 5. UI races ==');
  await t('rapid double-send: busy gate holds (one stream, not two)', async () => {
    await app.ev(`(function(){ document.getElementById('input').value = 'Control reply for race one'; document.getElementById('send').click(); document.getElementById('send').click(); document.getElementById('send').click(); })()`);
    await sleep(700);
    const busyMsgs = await app.ev(`document.querySelectorAll('#messages .msg.assistant.streaming, #messages .msg').length`);
    assert.equal(await waitSettled(15000), true);
    const disk = JSON.parse(fs.readFileSync(path.join(PROFILE, 'data', 'sessions', 'chaosmain.json'), 'utf8'));
    const controlReplies = disk.messages.filter((m) => m.role === 'assistant' && (m.content || '').includes('Control reply')).length;
    assert.equal(controlReplies, 1, 'exactly one reply for three clicks: ' + controlReplies);
  });
  await t('switch chat mid-stream: stream detaches cleanly, both chats intact', async () => {
    await app.ev(`(function(){ document.getElementById('input').value = 'Control reply for the race send'; document.getElementById('send').click(); })()`);
    // switch DURING the short stream's lifetime
    await app.ev(`Constellation.sessions.load('chaossmall')`, true);
    await sleep(1100);
    const s = await app.ev(`({
      n: document.querySelectorAll('#messages .msg').length,
      roles: Array.from(document.querySelectorAll('#messages .msg .role')).map((x) => x.textContent.trim()),
      pwned: window.__pwned,
    })`);
    assert.equal(s.pwned, 0);
    assert.equal(s.n, 2, 'DOM shows only chaossmall: ' + JSON.stringify(s.roles));
    await waitSettled(15000);
    const diskMain = JSON.parse(fs.readFileSync(path.join(PROFILE, 'data', 'sessions', 'chaosmain.json'), 'utf8'));
    assert.ok(Array.isArray(diskMain.messages), 'main chat JSON intact');
    const diskSmall = JSON.parse(fs.readFileSync(path.join(PROFILE, 'data', 'sessions', 'chaossmall.json'), 'utf8'));
    if (diskSmall.messages.length !== 2) {
      finding(
        'Mid-stream chat switch contaminates the NEW chat conversation',
        'src/js/stream.js — onDone pushes via H.getConv(), which resolves to the CURRENT conversation after the switch',
        'A stream started in chat A that finishes after switching to chat B appends its reply (and persists it) into chat B — cross-chat contamination. DOM showed ' + s.n + ' messages, disk chaossmall has ' + diskSmall.messages.length + '.',
        'tests/chaos/run.mjs → "switch chat mid-stream" (send, switch before done, inspect disk)',
        'Capture the conversation reference at stream START (const conv = H.getConv()) and push into that captured array — or cancel the in-flight stream when a session switch resets the DOM.',
      );
      record('mid-stream switch contaminated the new chat (finding recorded)', false, 'chaossmall disk: ' + diskSmall.messages.length + ' msgs');
    } else {
      record('no cross-chat contamination', true);
    }
  });
  await t('stop + resend flapping: state stays consistent', async () => {
    for (let i = 0; i < 3; i++) {
      await app.ev(`(function(){ document.getElementById('input').value = 'flap ' + ${i} + ' control'; document.getElementById('send').click(); })()`);
      await sleep(200);
      await app.ev(`(function(){ if (document.getElementById('send').classList.contains('stop')) document.getElementById('send').click(); })()`);
      await sleep(300);
    }
    assert.equal(await waitSettled(20000), true);
    const s = await app.ev(`({ input: !document.getElementById('input').disabled, pwned: window.__pwned, btn: document.getElementById('send').textContent })`);
    assert.equal(s.input, true); assert.equal(s.pwned, 0);
    assert.equal(s.btn, '➤', 'send button restored: ' + s.btn);
  });
  await t('final reload boots clean after everything', async () => {
    const errAt = app.events.length;
    await app.call('Page.reload', { ignoreCache: false });
    await sleep(3000);
    const thrown = app.events.slice(errAt).filter((e) => e.method === 'Runtime.exceptionThrown');
    assert.deepEqual(thrown, []);
    const boot = await app.ev(`!!(window.Constellation && window.Constellation.chat)`);
    assert.equal(boot, true);
  });
} catch (e) {
  fatal = e;
  console.log('\nFATAL (suite aborted): ' + e.message);
}

// ---------- teardown ----------
console.log('\n== teardown ==');
await app.kill();
try { mock.child.kill(); } catch (e) {}
await sleep(400);
let cleaned = false;
for (let i = 0; i < 4; i++) {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); cleaned = true; break; } catch (e) { await sleep(1000); }
}
console.log(cleaned ? 'profile deleted' : 'profile cleanup skipped (locked — disposable, removed next run)');

const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log('\n================ CHAOS REPORT ================');
console.log('\n-- DEFENDED CLEANLY (' + pass + ') --');
for (const r of results.filter((r) => r.ok)) console.log('  ✔ [' + r.suite + '] ' + r.name);
if (fail) {
  console.log('\n-- PROBLEMS DURING RUNS (' + fail + ') --');
  for (const r of results.filter((r) => !r.ok)) console.log('  ✖ [' + r.suite + '] ' + r.name + (r.detail ? ' — ' + r.detail : ''));
}
console.log('\n-- REAL BUGS / VULNERABILITIES (' + findings.length + ') --');
findings.forEach((f, i) => {
  console.log('  ' + (i + 1) + '. ' + f.title);
  console.log('     where: ' + f.file);
  console.log('     detail: ' + f.detail);
  console.log('     reproducer: ' + f.repro);
  console.log('     proposed fix: ' + f.fix);
});
console.log('\n' + (fatal ? 'ABORTED — ' : '') + pass + ' defended, ' + fail + ' problems, ' + findings.length + ' findings');
process.exit(fatal ? 1 : 0);
