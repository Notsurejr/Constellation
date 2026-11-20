// Unit — cardcompile.js: {{char}}/{{user}} substitution, block assembly, @@ decorator
// stripping, character_book → lorebook mapping (ST secondary keys → +must).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import cc from '../../src/js/cardcompile.js';

test('substitute resolves {{char}}/{{user}} case-insensitively', () => {
  assert.equal(cc.substitute('{{char}} meets {{USER}} for {{Char}}', 'Vex', 'Juno'), 'Vex meets Juno for Vex');
  assert.equal(cc.substitute(null, 'a', 'b'), '');
});

test('characterBlock includes only present fields and substitutes names', () => {
  const block = cc.characterBlock({ name: 'Vex', description: '{{char}} keeps the {{user}} log.', personality: 'gruff', scenario: 'the Hold', mesExample: '{{char}}: hello' }, 'Juno');
  assert.ok(block.startsWith('## Character — Vex'));
  assert.ok(block.includes('Vex keeps the Juno log.'));
  assert.ok(block.includes('Personality: gruff'));
  assert.ok(block.includes('Scenario: the Hold'));
  assert.ok(block.includes('### Example dialogue'));
  assert.ok(block.includes('Vex: hello'));
  const bare = cc.characterBlock({ name: 'Sable' }, 'Juno');
  assert.equal(bare, '## Character — Sable');
});

test('personaBlock names the player, with or without description', () => {
  assert.equal(cc.personaBlock({ name: 'Juno' }), '## You — Juno');
  assert.equal(cc.personaBlock({ name: 'Juno', description: 'the archivist' }), '## You — Juno\nthe archivist');
  assert.ok(cc.personaBlock(null).startsWith('## You — You'));
});

test('assemble stacks base → card → persona → tail, skipping absent layers', () => {
  const out = cc.assemble('BASE', { name: 'Vex' }, { name: 'Juno' }, 'Juno', 'TAIL');
  assert.deepEqual(out.split('\n\n'), ['BASE', '## Character — Vex', '## You — Juno', 'TAIL']);
  assert.equal(cc.assemble('', null, null, 'x', ''), '');
});

test('bookToLore: @@ decorators stripped, leading @@keep sticky, secondary_keys become +must', () => {
  const card = {
    name: 'Vex',
    characterBook: {
      name: 'Vex book',
      entries: [
        { keys: ['chart'], content: '@@id:1\n@@keep_activate_after_match\nchart facts', comment: 'Charts', constant: false, priority: 9 },
        { keys: ['calm'], secondary_keys: ['sea'], selective: true, content: 'calm facts' },
        { keys: [], content: '   ' },   // empty content filtered
      ],
    },
  };
  const book = cc.bookToLore(card);
  assert.equal(book.name, 'Vex book');
  assert.equal(book.entries.length, 2);
  const e1 = book.entries[0];
  assert.equal(e1.content, 'chart facts', 'leading @@ decorator lines stripped');
  assert.equal(e1.linger, 99, '@@keep_activate_after_match → sticky');
  assert.equal(e1.priority, 5, 'priority clamped to 5');
  assert.deepEqual(e1.keys, ['chart']);
  const e2 = book.entries[1];
  assert.deepEqual(e2.keys, ['calm', '+sea'], 'ST secondary_keys → +must operator');
  assert.equal(e2.linger, undefined);
});

test('bookToLore returns null without a usable book', () => {
  assert.equal(cc.bookToLore({}), null);
  assert.equal(cc.bookToLore({ characterBook: { entries: [] } }), null);
  assert.equal(cc.bookToLore({ characterBook: { entries: [{ keys: [], content: '  ' }] } }), null);
});

test('estimateTokens rounds up by fours', () => {
  assert.equal(cc.estimateTokens('abcd'), 1);
  assert.equal(cc.estimateTokens('abc'), 1);
  assert.equal(cc.estimateTokens('abcd'.repeat(2) + 'a'), 3);
  assert.equal(cc.estimateTokens(''), 0);
});
