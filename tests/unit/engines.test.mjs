// Unit — engines.js: lore retrieval (keys, wildcards, non-Latin, +must/-not, pickups,
// headings, chunks, budget cuts, linger/cooldown, depth) + phrase bans + display-filter parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import engines from '../../src/js/engines.js';

const lore = engines.lore;
const mk = (over) => Object.assign({ enabled: true, content: '' }, over);

async function run(activeLore, recent, opts) {
  return lore.buildLoreContext(activeLore, recent, null, Object.assign({ scanDepth: 4, budget: 8000, tag: 'lore' }, opts));
}

test('constant entries always fire and land in the system body', async () => {
  const r = await run([{ entries: [mk({ id: 'e1', title: 'The Hold', content: 'A salvage tug at berth 9.', constant: true })] }], [{ role: 'user', content: 'anything' }]);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].constant, true);
  assert.ok(r.body.includes('<lore:The Hold>'));
  assert.ok(r.body.includes('A salvage tug'));
  assert.ok(r.bodySurface.includes('<lore:The Hold>'));
});

test('keyword entries fire on word boundary only', async () => {
  const book = [{ entries: [mk({ id: 'e1', keys: ['war'], content: 'war facts' })] }];
  const hit = await run(book, [{ role: 'user', content: 'the war began yesterday' }]);
  assert.equal(hit.items.length, 1);
  const miss = await run(book, [{ role: 'user', content: 'the warming kettle hummed' }]);
  assert.equal(miss.items.length, 0);
  assert.equal(miss.entries[0].suppressed, 'no key in scan window');
});

test('* wildcard keys match derived forms', async () => {
  const book = [{ entries: [mk({ id: 'e1', keys: ['warp*'], content: 'warp facts' })] }];
  const r = await run(book, [{ role: 'user', content: 'the warpdrive hummed' }]);
  assert.equal(r.items.length, 1);
});

test('non-Latin keys fall back to substring matching', async () => {
  const book = [{ entries: [mk({ id: 'e1', keys: ['绯紗'], content: 'non-latin facts' })] }];
  const r = await run(book, [{ role: 'user', content: 'she whispered 绯紗 softly' }]);
  assert.equal(r.items.length, 1);
});

test('+must requires every must key; -not suppresses', async () => {
  const book = [{ entries: [mk({ id: 'e1', keys: ['+warp', '-calm'], content: 'x' })] }];
  assert.equal((await run(book, [{ role: 'user', content: 'warp engines steady' }])).items.length, 1);
  assert.equal((await run(book, [{ role: 'user', content: 'warp engines, stay calm' }])).items.length, 0);
  const mustOnly = [{ entries: [mk({ id: 'e2', keys: ['+warp'], content: 'x' })] }];
  assert.equal((await run(mustOnly, [{ role: 'user', content: 'warp sighted' }])).items.length, 1);
});

test('[[pickups]] extract keys (plain, |aliases one per segment, +rule, -rule) and strip from the wire', async () => {
  const p = lore.extractPickups('The [[Astartes|battle brother|shield brother]] stood. [[+Warp]] [[-dead]]');
  assert.deepEqual(p.keys, ['Astartes', 'battle brother', 'shield brother', '+Warp', '-dead']);
  assert.equal(p.text.includes('['), false);
  assert.ok(p.text.startsWith('The Astartes'));
});

test('classifyKeys routes operators', () => {
  const c = lore.classifyKeys(['+warp', '-dead', 'war', '']);
  assert.deepEqual(c, { any: ['war'], must: ['warp'], not: ['dead'] });
});

test('section headings in keyless smart entries fire their chunk', async () => {
  const book = [{ entries: [mk({ id: 'e1', content: '# The Hold\nBerth nine facts, cold and salted.' })] }];
  const r = await run(book, [{ role: 'user', content: 'tell me about the hold' }]);
  assert.equal(r.items.length, 1);
  assert.ok(r.entries[0].how.includes('chunk pickup') || r.entries[0].how.includes('BM25') || r.entries[0].how.includes('passage'));
});

test('lore_budget cuts lowest priority first', async () => {
  const long = 'x'.repeat(3000);
  const book = [{ entries: [
    mk({ id: 'hi', title: 'High', content: long, constant: true, priority: 5 }),
    mk({ id: 'lo', title: 'Low', content: long, constant: true, priority: 1 }),
  ] }];
  const r = await run(book, [{ role: 'user', content: 'x' }], { budget: 2000 });
  const hi = r.items.find((i) => i.label === 'High');
  const lo = r.items.find((i) => i.label === 'Low');
  assert.ok(hi && hi.text.length > 0);
  assert.ok(!lo || lo.text.length < 2000, 'low priority should be cut or trimmed');
  const loEntry = r.entries.find((e) => e.title === 'Low');
  assert.ok(loEntry.cut === true || (loEntry.included && loEntry.cut === false && loEntry === undefined) || loEntry.cut === true);
});

test('linger keeps an entry active N turns after its last match', async () => {
  const book = [{ entries: [mk({ id: 'e1', keys: ['warp'], content: 'warp facts', linger: 3 })] }];
  const state = { e1: { lastActive: 3, lastFired: 3 } };
  const r = await run(book, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }, { role: 'user', content: 'e' }], { state });
  assert.equal(r.items.length, 1);
  assert.ok(r.entries[0].how.startsWith('lingering'));
  assert.equal(r.state.e1.lastActive, 5);
});

test('cooldown rests an entry after firing', async () => {
  const book = [{ entries: [mk({ id: 'e1', keys: ['warp'], content: 'warp facts', cooldown: 2 })] }];
  const state = { e1: { lastActive: 4, lastFired: 4 } };
  const r = await run(book, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }, { role: 'user', content: 'warp now' }], { state });
  assert.equal(r.items.length, 0);
  assert.ok(r.entries[0].suppressed.startsWith('cooldown'));
});

test('stale state (lastActive beyond current turn) cannot linger or cool down', async () => {
  const book = [{ entries: [mk({ id: 'e1', keys: ['warp'], content: 'warp facts', linger: 9, cooldown: 9 })] }];
  const state = { e1: { lastActive: 99, lastFired: 99 } };
  const r = await run(book, [{ role: 'user', content: 'plain text, no keys' }], { state });
  assert.equal(r.items.length, 0);
  assert.equal(r.entries[0].suppressed, 'no key in scan window');
});

test('depth entries ride the stack and stay out of the surface body', async () => {
  const book = [{ entries: [mk({ id: 'e1', title: 'Deep', content: 'deep facts', constant: true, depth: 2 })] }];
  const r = await run(book, [{ role: 'user', content: 'x' }]);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].depth, 2);
  assert.ok(r.body.includes('<lore:Deep>'));
  assert.equal(r.bodySurface.includes('<lore:Deep>'), false);
});

test('enabled:false entries never fire', async () => {
  const book = [{ entries: [mk({ id: 'e1', content: 'x', constant: true, enabled: false })] }];
  const r = await run(book, [{ role: 'user', content: 'x' }]);
  assert.equal(r.items.length, 0);
});

test('phrase bans: parse, word boundaries, case-insensitive replace, bare delete', () => {
  const rules = engines.bans.parse('foo = bar\nwhisper\n');
  assert.equal(rules.length, 2);
  assert.equal(engines.bans.apply('The FOO stays put — foobar untouched, whisper gone.', rules), 'The bar stays put — foobar untouched,  gone.');
});

test('chunkText merges paragraphs to budget and splits oversized ones', () => {
  const chunks = lore.chunkText('para one.\npara two.\npara three.', 40);
  assert.ok(chunks.every((c) => c.length <= 64));
  const big = lore.chunkText('a'.repeat(30) + '. ' + 'b'.repeat(30) + '. ' + 'c'.repeat(30) + '.', 40);
  assert.ok(big.length >= 2);
  assert.ok(big.every((c) => c.length > 0));
});

test('bm25Scores ranks the doc containing the query term higher', () => {
  const docs = [
    { tokens: lore.loreTokenize('the kettle whistles softly') },
    { tokens: lore.loreTokenize('the warp engine hums loud') },
  ];
  const scored = lore.bm25Scores(docs, lore.loreTokenize('warp engine'));
  assert.ok(scored[1].score > scored[0].score);
});

test('display filter parser: enabled, # disabled, invalid regex skipped, $1 replacement kept', () => {
  const rules = engines.displayFilters.parse([
    '/the ([A-Za-z]+)/ => $1!',
    '# /gone/i',
    '/[/',
    'not a rule',
    '',
  ].join('\n'));
  assert.equal(rules.length, 3);
  assert.equal(rules[0].valid, true);
  assert.equal(rules[0].enabled, true);
  assert.equal(rules[0].repl, '$1!');
  assert.equal(rules[1].valid, true);
  assert.equal(rules[1].enabled, false);
  assert.equal(rules[2].valid, false);
  const applied = 'the quick brown fox'.replace(rules[0].re, rules[0].repl);
  assert.equal(applied, 'quick! brown fox');
});
