// Unit — mdexport.js: Obsidian-flavored markdown export (model labels, mixed models
// frontmatter, edited markers, thinking folding, filename sanitizing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mdexport from '../../mdexport.js';

const sess = {
  title: 'A Test: Chat?',
  model: 'glm-5.3',
  messages: [
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'answer one', reasoning: 'deep thoughts', model: 'glm-5.3' },
    { role: 'user', content: 'second' },
    { role: 'assistant', content: 'answer two — sculpted', edited: true, orig: 'answer two', model: 'mock-1' },
  ],
};

test('frontmatter carries title, app, model, counts — and a models line when replies switched', () => {
  const md = mdexport.chatToMarkdown(sess, { thinking: true, system: false });
  assert.ok(md.startsWith('---\n'));
  assert.ok(md.includes('title: "A Test: Chat?"'));
  assert.ok(md.includes('app: Constellation'));
  assert.ok(md.includes('model: glm-5.3'));
  assert.ok(md.includes('models: glm-5.3 (1), mock-1 (1)'));
  assert.ok(md.includes('messages: 4'));
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('per-reply model labels: glm prefixed ids pretty-print, others pass through; edited marker', () => {
  const md = mdexport.chatToMarkdown(sess, { thinking: false, system: false });
  assert.ok(md.includes('> [!NOTE] GLM-5.3'));
  assert.ok(md.includes('> [!NOTE] mock-1 · ✎ edited'));
  assert.ok(!md.includes('answer two\n'), 'the edited reply keeps its new content');
});

test('thinking blocks fold as [!abstract]- callouts; system prompt optional', () => {
  const md = mdexport.chatToMarkdown(sess, { thinking: true, system: false });
  assert.ok(md.includes('> [!abstract]- ✦ Thinking'));
  assert.ok(md.includes('> deep thoughts'));
  const noThink = mdexport.chatToMarkdown(sess, { thinking: false, system: false });
  assert.ok(!noThink.includes('abstract'));
  const withSys = mdexport.chatToMarkdown(Object.assign({}, sess, { system: 'be nice' }), { thinking: false, system: true });
  assert.ok(withSys.includes('> [!quote]- ✦ System prompt'));
  assert.ok(withSys.includes('> be nice'));
});

test('thinking-only turns emit the fold but no empty body callout', () => {
  const md = mdexport.chatToMarkdown({ title: 't', model: 'glm-5.3', messages: [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: '', reasoning: 'only thought' },
  ] }, { thinking: true, system: false });
  assert.ok(md.includes('[!abstract]- ✦ Thinking'));
  assert.equal((md.match(/\[!NOTE\]/g) || []).length, 0);
});

test('safeFileTitle strips hostile characters, caps at 60, falls back to "chat"', () => {
  assert.equal(mdexport.safeFileTitle('A Test: Chat?'), 'A Test Chat');
  assert.equal(mdexport.safeFileTitle('../../etc/passwd'), '....etcpasswd', 'slashes stripped (no traversal); dots are harmless in a title');
  assert.equal(mdexport.safeFileTitle('x'.repeat(80)).length, 60);
  assert.equal(mdexport.safeFileTitle('   '), 'chat');
  assert.equal(mdexport.safeFileTitle(null), 'chat');
});

test('prettyModel maps glm ids, passes others, defaults empty', () => {
  assert.equal(mdexport.prettyModel('glm-5.3'), 'GLM-5.3');
  assert.equal(mdexport.prettyModel('glm_5'), 'GLM_5');
  assert.equal(mdexport.prettyModel('mock-1'), 'mock-1');
  assert.equal(mdexport.prettyModel(''), 'GLM');
  assert.equal(mdexport.prettyModel(null), 'GLM');
});
