// Unit — mainutil.js: PNG card extraction (tEXt/zTXt, ccv3 preference, hostile inputs),
// card normalization, safeId, SETTINGS_SPEC reading/clamping, retry policy, backup key
// redaction, and the Gemini <thought> splitter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import M from '../../src/js/mainutil.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  return out;
}
function pngBuf(chunks) { return Buffer.concat([PNG_SIG, ...chunks]); }
const cardJson = (name) => Buffer.from(JSON.stringify({ data: { name, description: 'desc of ' + name } })).toString('base64');

test('extractCardFromPng reads a plain tEXt chara chunk', () => {
  const buf = pngBuf([chunk('tEXt', Buffer.from('chara\0' + cardJson('Vex'), 'latin1')), chunk('IEND', Buffer.alloc(0))]);
  const card = M.extractCardFromPng(buf);
  assert.equal(card.data.name, 'Vex');
});

test('extractCardFromPng inflates a zTXt chunk (compression method 0)', () => {
  const data = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from([0]), zlib.deflateSync(cardJson('Marrow'))]);
  const buf = pngBuf([chunk('zTXt', data), chunk('IEND', Buffer.alloc(0))]);
  assert.equal(M.extractCardFromPng(buf).data.name, 'Marrow');
});

test('ccv3 wins when both chunks exist', () => {
  const buf = pngBuf([
    chunk('tEXt', Buffer.from('chara\0' + cardJson('V2'), 'latin1')),
    chunk('tEXt', Buffer.from('ccv3\0' + cardJson('V3'), 'latin1')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.equal(M.extractCardFromPng(buf).data.name, 'V3');
});

test('hostile PNGs fail safe: non-PNG, truncated, no chunks, invalid base64 JSON', () => {
  assert.equal(M.extractCardFromPng(Buffer.from('GIF89a-not-a-png-at-all- really long padding'), null), null);
  assert.equal(M.extractCardFromPng(PNG_SIG), null);
  assert.equal(M.extractCardFromPng(pngBuf([chunk('tEXt', Buffer.from('other\0value')), chunk('IEND', Buffer.alloc(0))])), null);
  const bad = pngBuf([chunk('tEXt', Buffer.from('chara\0!!!not-base64-json!!!')), chunk('IEND', Buffer.alloc(0))]);
  assert.equal(M.extractCardFromPng(bad), null);
  const cut = pngBuf([chunk('tEXt', Buffer.from('chara\0' + cardJson('Cut')))]);
  assert.equal(M.extractCardFromPng(cut.slice(0, 20)), null);   // truncated mid-chunk
  assert.equal(M.extractCardFromPng(Buffer.alloc(0)), null);
});

test('normalizeCard prefers the v2 data wrapper and coerces fields', () => {
  const n = M.normalizeCard({ spec: 'chara_card_v2', data: { name: 'Vex', description: 'd', first_mes: 'hi', alternate_greetings: ['g'], tags: ['t1'], character_book: { entries: [{ content: 'c' }] } } });
  assert.equal(n.name, 'Vex');
  assert.equal(n.firstMes, 'hi');
  assert.deepEqual(n.altGreetings, ['g']);
  assert.ok(n.characterBook && n.characterBook.entries.length === 1);
  assert.equal(n.spec, 'chara_card_v2');
  const root = M.normalizeCard({ name: 'Root', greeting: 'yo' });
  assert.equal(root.firstMes, 'yo');
  assert.equal(root.spec, 'chara_card_v2');
  assert.equal(M.normalizeCard({ data: { description: 'no name' } }), null);
  assert.equal(M.normalizeCard(null), null);
  const steering = M.normalizeCard({ data: { name: 'V', system_prompt: '  be cruel  ', post_history_instructions: '  ' } });
  assert.equal(steering.systemPrompt, '  be cruel  ', 'the stored prompt keeps its raw text — only the FLAG consults trim()');
  assert.equal(steering.hasSystemPrompt, true);
  assert.equal(steering.hasPhi, false);
});

test('safeId blocks traversal and non-word ids, accepts plain ones', () => {
  assert.equal(M.safeId('s_123-ok'), 's_123-ok');
  assert.equal(M.safeId('../../etc/passwd'), null);
  assert.equal(M.safeId('has.dot.json'), null);
  assert.equal(M.safeId(''), null);
  assert.equal(M.safeId(123), null);
  assert.equal(M.safeId('x'.repeat(81)), null);
  assert.equal(M.safeId('x'.repeat(80)).length, 80);
});

test('SETTINGS_SPEC reading: clamps, defaults, onoff, enum, hex, key env fallback', () => {
  const row = (k) => M.SETTINGS_SPEC.find((r) => r[0] === k);
  assert.equal(M.readSetting(row('context_window'), { context_window: '99999999' }), 1000000);
  assert.equal(M.readSetting(row('context_window'), { context_window: '-5' }), 0);
  assert.equal(M.readSetting(row('context_window'), { context_window: 'garbage' }), 0);
  assert.equal(M.readSetting(row('context_window'), {}), 0);
  assert.equal(M.readSetting(row('temperature'), { temperature: '0.5' }), 0.5);
  assert.equal(M.readSetting(row('temperature'), { temperature: 'abc' }), 0.8);
  assert.equal(M.readSetting(row('stream_cps'), { stream_cps: '5000' }), 2000);
  assert.equal(M.readSetting(row('thinking'), { thinking: 'on' }), true);
  assert.equal(M.readSetting(row('thinking'), { thinking: 'OFF' }), false);
  assert.equal(M.readSetting(row('thinking'), { thinking: '1' }), true);
  assert.equal(M.readSetting(row('thinking'), {}), false);
  assert.equal(M.readSetting(row('reasoning_effort'), { reasoning_effort: 'xhigh' }), 'xhigh');
  assert.equal(M.readSetting(row('reasoning_effort'), { reasoning_effort: 'bogus' }), 'max');
  assert.equal(M.readSetting(row('accent'), { accent: '#aabbcc' }), '#aabbcc');
  assert.equal(M.readSetting(row('accent'), { accent: '#12345' }), '');
  delete process.env.ZAI_API_KEY;
  assert.equal(M.readSetting(row('api_key'), {}), '');
  process.env.ZAI_API_KEY = 'env-key';
  assert.equal(M.readSetting(row('api_key'), {}), 'env-key');
  assert.equal(M.readSetting(row('api_key'), { api_key: 'explicit' }), 'explicit');
  delete process.env.ZAI_API_KEY;
  assert.equal(M.clamp(5, 0, 3), 3);
  assert.equal(M.clamp(-1, 0, 3), 0);
});

test('isRetryable: transient yes, billing/auth no, unknown yes', () => {
  assert.equal(M.isRetryable({ status: 429 }), true);
  assert.equal(M.isRetryable({ status: 500 }), true);
  assert.equal(M.isRetryable({ status: 408 }), true);
  assert.equal(M.isRetryable({ status: 401 }), false);
  assert.equal(M.isRetryable({ message: '余额不足' }), false);
  assert.equal(M.isRetryable({ message: 'insufficient credits for this model' }), false);
  assert.equal(M.isRetryable({}), true);
  assert.equal(M.isRetryable(new Error('socket hung up')), true);
});

test('backup key redaction + restore merge', () => {
  const settingsText = 'api_key: sk-secret\nmodel: glm-5.3\n# api_key: commented';
  const red = M.redactSettingsText(settingsText);
  assert.ok(!red.includes('sk-secret'));
  assert.ok(red.startsWith('api_key: \nmodel: glm-5.3'));
  assert.equal(M.redactSettingsText(null), '');
  const incoming = 'api_key: \nmodel: glm-5.3';
  assert.equal(M.mergeKeyOnRestore(incoming, 'api_key: local-key\nmodel: glm-5.3'), 'api_key: local-key\nmodel: glm-5.3');
  assert.equal(M.mergeKeyOnRestore('api_key: incoming-key', 'api_key: local-key'), 'api_key: incoming-key');
  assert.equal(M.mergeKeyOnRestore('api_key: ', ''), 'api_key: ');
});

test('createGeminiSplit peels <thought> blocks, survives straddling markers, flushes the tail', () => {
  const s = M.createGeminiSplit();
  let text = '', think = '';
  let p = s('hello ');
  text += p.text; think += p.think;
  p = s('<thought>secret plan ');
  text += p.text; think += p.think;
  p = s('part two</thought> the answer');
  text += p.text; think += p.think;
  p = s.flush();   // the splitter holds the last 8 chars for marker-prefix safety — flush releases them
  text += p.text; think += p.think;
  assert.equal(text, 'hello  the answer');
  assert.equal(think, 'secret plan part two');
  // straddle the OPENING marker across two chunks
  const s2 = M.createGeminiSplit();
  let t2 = '', k2 = '';
  let q = s2('A <thou');
  t2 += q.text; k2 += q.think;
  q = s2('ght>X</thought>B');
  t2 += q.text; k2 += q.think;
  q = s2.flush();
  t2 += q.text; k2 += q.think;
  assert.equal(t2, 'A B');
  assert.equal(k2, 'X');
  // unterminated thought → emissions + flush together hand back the hold as think
  const s3 = M.createGeminiSplit();
  let think3 = '';
  let r3 = s3('plain ');
  think3 += r3.think;
  r3 = s3('<thought>never closed tail');
  think3 += r3.think;
  const fl = s3.flush();
  think3 += fl.think;
  assert.equal(fl.text, '');
  assert.equal(think3, 'never closed tail');
  assert.equal(s3.flush().think, '', 'flush resets the hold');
});

test('localDateStamp + estTok', () => {
  assert.match(M.localDateStamp(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(M.estTok('abcd'.repeat(4)), 4);
  assert.equal(M.estTok(null), 0);
});
