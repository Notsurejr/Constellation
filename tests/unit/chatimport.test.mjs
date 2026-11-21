// Unit — chatimport.js: every supported import format + normalization rules + edge cases.
// All fixtures are synthetic; no real chat text ever enters the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import chatimport from '../../src/js/chatimport.js';
import mdexport from '../../mdexport.js';

// ---------- helpers ----------
const anthropicChat = (name, msgs) => ({ uuid: 'c', name, created_at: '2026-01-02T10:00:00Z', chat_messages: msgs });
const anthropicMsg = (sender, blocks) => ({ sender, content: blocks });
const text = (t) => ({ type: 'text', text: t });
const think = (t) => ({ type: 'thinking', thinking: t });
const tool = () => ({ type: 'tool_use', name: 'tool', input: {} });

// ---------- detection & non-collision ----------
test('detect: chara_card_v2 JSON is recognized as a card, never a chat', () => {
  const card = JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Vex', description: 'desc', personality: 'p' } });
  assert.equal(chatimport.detect(card), 'card');
  assert.equal(chatimport.parse(card).chats.length, 0);
});

test('detect: corrupt JSON and random prose fall back cleanly', () => {
  assert.equal(chatimport.detect('{oops not json'), 'unknown');
  assert.equal(chatimport.detect('just some prose without markers'), 'unknown');
  const r = chatimport.parse('just some prose without markers\nline two\nline three');
  assert.equal(r.format, 'unknown');
  assert.ok(r.rawPreview.includes('just some prose'));
  assert.ok(r.rawPreview.split('\n').length <= 25);
});

// ---------- Anthropic ----------
test('anthropic single chat: text/thinking/tool blocks + thinking OFF strips with a warning', () => {
  const j = JSON.stringify(anthropicChat('Chaos Chat', [
    anthropicMsg('human', [text('Hello there')]),
    anthropicMsg('assistant', [think('inner plan'), text('Hi!'), tool()]),
    anthropicMsg('human', [text('   ')]),
    anthropicMsg('human', [text('Follow-up')]),
  ]));
  const r = chatimport.parse(j);
  assert.equal(r.format, 'anthropic');
  assert.equal(r.chats.length, 1);
  const chat = r.chats[0];
  assert.equal(chat.title, 'Chaos Chat');
  assert.equal(chat.count, 3, 'empty turn dropped: ' + JSON.stringify(chat.turns.map((t) => t.content)));
  assert.deepEqual(chat.turns.map((t) => t.role), ['user', 'assistant', 'user']);
  assert.equal(chat.turns[1].content, 'Hi!');
  assert.ok(chat.warnings.some((w) => w.includes('Stripped 1 thinking block')));
  assert.ok(chat.warnings.some((w) => w.includes('Dropped 1 empty turn')));
  assert.ok(chat.warnings.some((w) => w.includes('tool-use')));
});
test('anthropic thinking ON stores reasoning; multi-text blocks join', async () => {
  const j = JSON.stringify(anthropicChat('C', [
    anthropicMsg('human', [text('Q')]),
    anthropicMsg('assistant', [think('plan part 1'), think('plan part 2'), text('Line A'), text('Line B')]),
  ]));
  const r = chatimport.parse(j, { includeThinking: true });
  const a = r.chats[0].turns[1];
  assert.equal(a.reasoning, 'plan part 1\n\nplan part 2');
  assert.equal(a.content, 'Line A\n\nLine B');
});
test('anthropic conversations.json: multi-chat metadata + lazy parseOne', () => {
  const j = JSON.stringify([
    anthropicChat('First', [anthropicMsg('human', [text('a')]), anthropicMsg('assistant', [text('b')]), anthropicMsg('human', [text('c')])]),
    anthropicChat('Second', [anthropicMsg('human', [text('x')]), anthropicMsg('assistant', [text('y')])]),
  ]);
  const r = chatimport.parse(j);
  assert.equal(r.multiChat, true);
  assert.equal(r.chats.length, 2);
  assert.deepEqual(r.chats.map((c) => c.count), [3, 2]);
  assert.ok(r.chats[0].turns === undefined, 'metadata only — normalization is lazy');
  const one = chatimport.parseOne(j, 1);
  assert.equal(one.chats[0].title, 'Second');
  assert.equal(one.chats[0].turns.length, 2);
  assert.equal(one.chats[0].turns[0].content, 'x');
});

// ---------- ChatGPT ----------
function gptFixture() {
  const mapping = {
    root: { id: 'root', message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['sys prompt'] } }, parent: null, children: ['a'] },
    a: { id: 'a', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Question one'] } }, parent: 'root', children: ['b'] },
    b: { id: 'b', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Answer one'] } }, parent: 'a', children: ['c'] },
    side: { id: 'side', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['abandoned branch'] } }, parent: 'a', children: [] },
    c: { id: 'c', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Question two'] } }, parent: 'b', children: ['tool'] },
    tool: { id: 'tool', message: { author: { role: 'tool' }, content: { content_type: 'text', parts: ['tool output'] } }, parent: 'c', children: ['d'] },
    d: { id: 'd', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Answer two'] }, metadata: { model_slug: 'gpt-x' } }, parent: 'tool', children: [] },
  };
  return JSON.stringify({ title: 'GPT Chat', create_time: 1700000000, mapping, current_node: 'd' });
}
test('chatgpt mapping tree: active branch from current_node, system/tool skipped, model stamps', () => {
  const r = chatimport.parse(gptFixture());
  assert.equal(r.format, 'chatgpt');
  const chat = r.chats[0];
  assert.equal(chat.title, 'GPT Chat');
  assert.deepEqual(chat.turns.map((t) => t.content), ['Question one', 'Answer one', 'Question two', 'Answer two']);
  assert.equal(chat.turns[3].model, 'gpt-x');
  assert.ok(chat.warnings.some((w) => w.includes('Skipped 2')));
  assert.ok(!JSON.stringify(chat.turns).includes('abandoned branch'));
});
test('chatgpt conversations.json: multi-chat metadata + parseOne', () => {
  const two = JSON.stringify([
    { title: 'One', create_time: 1700000000, mapping: { n1: { id: 'n1', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['u'] } }, parent: null, children: [] } }, current_node: 'n1' },
    { title: 'Two', create_time: 1700000001, mapping: { n1: { id: 'n1', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['u2'] } }, parent: null, children: [] } }, current_node: 'n1' },
  ]);
  const r = chatimport.parse(two);
  assert.equal(r.multiChat, true);
  assert.deepEqual(r.chats.map((c) => c.title), ['One', 'Two']);
  const one = chatimport.parseOne(two, 1);
  assert.equal(one.chats[0].turns[0].content, 'u2');
});

// ---------- AI Studio JSON ----------
test('aistudio chunkedPrompt: isThought honored on/off', () => {
  const j = JSON.stringify({ chunkedPrompt: { chunks: [
    { role: 'user', text: 'prompt one' },
    { role: 'model', text: 'thought bits', isThought: true },
    { role: 'model', text: 'answer one' },
  ] } });
  const off = chatimport.parse(j);
  assert.equal(off.format, 'aistudio');
  assert.deepEqual(off.chats[0].turns.map((t) => t.content), ['prompt one', 'answer one']);
  assert.ok(off.chats[0].warnings.some((w) => w.includes('thinking block')));
  const on = chatimport.parse(j, { includeThinking: true });
  assert.equal(on.chats[0].turns[1].reasoning, 'thought bits');
});

// ---------- SillyTavern jsonl ----------
test('sillytavern jsonl: is_user/mes + swipes become variants with vActive', () => {
  const j = [
    JSON.stringify({ name: 'User', is_user: true, mes: 'hi' }),
    JSON.stringify({ name: 'Char', is_user: false, mes: 'second take', swipes: ['first take', 'second take', 'third take'] }),
    JSON.stringify({ name: 'User', is_user: true, mes: 'ok' }),
  ].join('\n');
  const r = chatimport.parse(j);
  assert.equal(r.format, 'st_jsonl');
  assert.equal(r.chats[0].turns.length, 3);
  const sw = r.chats[0].turns[1];
  assert.equal(sw.variants.length, 3);
  assert.equal(sw.vActive, 1);
  assert.equal(sw.content, 'second take');
});
test('sillytavern swapRoles flips roles', () => {
  const j = JSON.stringify({ name: 'U', is_user: true, mes: 'hello' });
  const r = chatimport.parse(j, { swapRoles: true });
  assert.equal(r.chats[0].turns[0].role, 'assistant');
});

// ---------- Constellation backups ----------
test('constellation backup: multi-session checklist, native fields preserved, api_key stripped', () => {
  const backup = JSON.stringify({
    app: 'constellation', version: 1, exportedAt: 1,
    config: { settings: { api_key: 'sk-do-not-import' } },
    sessions: {
      s1: { id: 's1', title: 'First Story', system: 'SYS prompt', project: 'PROJ', updatedAt: 1700000000000, messages: [
        { role: 'user', content: 'u1', api_key: 'stray' },
        { role: 'assistant', content: 'a1-v2', reasoning: 'r1', model: 'mock-1', variants: [{ content: 'a1-v1' }, { content: 'a1-v2' }], vActive: 1 },
      ] },
      s2: { id: 's2', title: 'Second', updatedAt: 1, messages: [{ role: 'user', content: 'x' }] },
    },
  });
  const r = chatimport.parse(backup);
  assert.equal(r.format, 'constellation');
  assert.equal(r.multiChat, true);
  assert.deepEqual(r.chats.map((c) => c.title), ['First Story', 'Second']);
  const one = chatimport.parseOne(backup, 0, { includeThinking: true, includeSystem: true });
  const chat = one.chats[0];
  assert.equal(chat.system, 'SYS prompt');
  assert.equal(chat.project, 'PROJ');
  assert.equal(chat.turns[1].model, 'mock-1');
  assert.equal(chat.turns[1].vActive, 1);
  assert.equal(chat.turns[1].variants.length, 2);
  assert.equal(chat.turns[1].reasoning, 'r1');
  assert.ok(!JSON.stringify(chat).includes('sk-do-not-import'));
});
test('constellation single session (no backup wrapper) imports directly', () => {
  const j = JSON.stringify({ id: 'x', title: 'Solo', system: 'S', messages: [{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }] });
  const r = chatimport.parse(j);
  assert.equal(r.chats[0].title, 'Solo');
  assert.equal(r.chats[0].system, 'S');
});

// ---------- Claude MD ----------
test('claude md: headers, timestamps stripped, model line, thinking on/off', () => {
  const md = [
    '---',
    'title: Imports Test',
    '---',
    '',
    '## User',
    '2026-01-02 10:11 AM',
    'What is the plan?',
    '',
    '## Claude',
    '**Model:** claude-x',
    '### Thinking',
    'weigh options',
    '',
    '### Response',
    'The plan is simple.',
    '',
    '## User',
    'Go on.',
  ].join('\n');
  const off = chatimport.parse(md);
  assert.equal(off.format, 'md_claude');
  assert.equal(off.chats[0].title, 'Imports Test');
  assert.deepEqual(off.chats[0].turns.map((t) => t.content), ['What is the plan?', 'The plan is simple.', 'Go on.']);
  assert.equal(off.chats[0].turns[1].model, 'claude-x');
  assert.ok(off.chats[0].warnings.some((w) => w.includes('thinking block')));
  const on = chatimport.parse(md, { includeThinking: true });
  assert.equal(on.chats[0].turns[1].reasoning, 'weigh options');
});
test('claude md: multi-paragraph ### Thinking keeps blank-line paragraphs, ends at the closer', () => {
  const md = [
    '## User',
    'q',
    '',
    '## Claude',
    '### Thinking',
    'para one',
    '',
    'para two',
    '',
    '### Response',
    'The answer, visible.',
    '',
    '## User',
    'next',
  ].join('\n');
  const on = chatimport.parse(md, { includeThinking: true });
  const a = on.chats[0].turns[1];
  assert.equal(a.reasoning, 'para one\n\npara two');
  assert.equal(a.content, 'The answer, visible.');
  const off = chatimport.parse(md);
  assert.equal(off.chats[0].turns[1].content, 'The answer, visible.');
  assert.equal(off.chats[0].turns[1].reasoning, undefined);
});
test('claude md: --- divider and </details> close a thinking block; blank falls back when no closer', () => {
  const divider = ['## Claude', '### Thinking', 'thoughts', '', '---', 'Visible answer.'].join('\n');
  const r1 = chatimport.parse(divider, { includeThinking: true });
  assert.equal(r1.chats[0].turns[0].reasoning, 'thoughts');
  assert.equal(r1.chats[0].turns[0].content, 'Visible answer.');
  const details = ['## Claude', '### Thinking', '<details>', 'thoughts', '</details>', 'Visible answer.'].join('\n');
  const r2 = chatimport.parse(details, { includeThinking: true });
  assert.equal(r2.chats[0].turns[0].reasoning, 'thoughts');
  assert.equal(r2.chats[0].turns[0].content, 'Visible answer.');
  const fallback = ['## Claude', '### Thinking', 'thoughts', '', 'Visible answer with no closer.'].join('\n');
  const r3 = chatimport.parse(fallback, { includeThinking: true });
  assert.equal(r3.chats[0].turns[0].reasoning, 'thoughts');
  assert.equal(r3.chats[0].turns[0].content, 'Visible answer with no closer.');
});
test('claude md: <thinking> blocks end on the closing tag', () => {
  const md = '## User\nq\n\n## Claude\n<thinking>\ninner\n</thinking>\nanswer body';
  const r = chatimport.parse(md, { includeThinking: true });
  assert.equal(r.chats[0].turns[1].reasoning, 'inner');
  assert.equal(r.chats[0].turns[1].content, 'answer body');
});

// ---------- ChatGPT / Gemini raw MD ----------
test('chatgpt/gemini md: ## Prompt:/## Response: with > Thinking blockquotes', () => {
  const md = [
    '## Prompt:',
    'What about this?',
    '',
    '## Response:',
    '> Thinking:',
    '> first check',
    '> then check again',
    'The answer stands.',
  ].join('\n');
  const on = chatimport.parse(md, { includeThinking: true });
  assert.equal(on.format, 'md_chatgpt');
  assert.deepEqual(on.chats[0].turns.map((t) => t.role), ['user', 'assistant']);
  assert.equal(on.chats[0].turns[1].reasoning, 'first check\nthen check again');
  assert.equal(on.chats[0].turns[1].content, 'The answer stands.');
  const off = chatimport.parse(md);
  assert.equal(off.chats[0].turns[1].reasoning, undefined);
});

// ---------- Obsidian callouts ----------
test('obsidian callouts: frontmatter, [!summary] strip, one-> strip, fence immunity, model labels', () => {
  const md = [
    '---',
    'title: Ledger Notes',
    '---',
    '',
    '> [!summary] Exported from somewhere',
    '> quick summary line',
    '',
    '---',
    '',
    '> [!QUESTION] User',
    '> What changed at berth nine?',
    '',
    '> [!NOTE] GLM-5.3 · ✎ edited',
    '> The levy doubled, and no one signed it.',
    '>',
    '> ```manifest',
    '> [!NOTE] inside a fence — must not split',
    '> ```',
    '',
    '> [!abstract]- ✦ Thinking',
    '> check the levy line',
  ].join('\n');
  const off = chatimport.parse(md);
  assert.equal(off.format, 'md_callout');
  assert.equal(off.chats[0].title, 'Ledger Notes');
  const turns = off.chats[0].turns;
  assert.deepEqual(turns.map((t) => t.role), ['user', 'assistant']);
  assert.equal(turns[1].model, 'GLM-5.3');
  assert.ok(turns[1].content.includes('[!NOTE] inside a fence'), 'fenced callout line stays content');
  assert.equal(turns.length, 2, 'no phantom turn from the fenced callout');
  const on = chatimport.parse(md, { includeThinking: true });
  assert.equal(on.chats[0].turns[1].reasoning, 'check the levy line');
});
test('mdexport round-trip: Constellation export parses back to the same conversation', () => {
  const md = mdexport.chatToMarkdown({ title: 'Round Trip', model: 'glm-5.3', system: 'Be brief.', messages: [
    { role: 'user', content: 'Question one?' },
    { role: 'assistant', content: 'Answer one.', reasoning: 'hidden thought', model: 'glm-5.3' },
  ] }, { thinking: true, system: true });
  const r = chatimport.parse(md, { includeThinking: true, includeSystem: true });
  assert.equal(r.format, 'md_callout');
  const chat = r.chats[0];
  assert.equal(chat.title, 'Round Trip');
  assert.equal(chat.system, 'Be brief.');
  assert.equal(chat.turns.length, 2);
  assert.equal(chat.turns[0].content, 'Question one?');
  assert.equal(chat.turns[1].content, 'Answer one.');
  assert.equal(chat.turns[1].model, 'GLM-5.3');
  assert.equal(chat.turns[1].reasoning, 'hidden thought');
});

// ---------- AI Studio pasted MD ----------
test('aistudio pasted md: > User markers with quoted user turns and unquoted answers', () => {
  const md = [
    '> User',
    '> What is the plan?',
    '',
    'The plan is two lines:',
    'one, two.',
    '',
    '> User',
    '> And now?',
  ].join('\n');
  const r = chatimport.parse(md);
  assert.equal(r.format, 'md_aistudio');
  assert.deepEqual(r.chats[0].turns.map((t) => t.role), ['user', 'assistant', 'user']);
  assert.equal(r.chats[0].turns[0].content, 'What is the plan?');
  assert.equal(r.chats[0].turns[1].content, 'The plan is two lines:\none, two.');
  assert.equal(r.chats[0].turns[2].content, 'And now?');
});

// ---------- generic fallback ----------
test('generic: ### Human / ### AI header pairs', () => {
  const md = '### Human\nWhat happened at the docks?\n\n### AI\nThree crates, one seal broken.';
  const r = chatimport.parse(md);
  assert.equal(r.format, 'generic');
  assert.deepEqual(r.chats[0].turns.map((t) => t.role), ['user', 'assistant']);
  assert.equal(r.chats[0].turns[0].content, 'What happened at the docks?');
});
test('generic: **User:** / **Assistant:** inline prefixes', () => {
  const md = '**User:** Go.\n\n**Assistant:** Done.';
  const r = chatimport.parse(md);
  assert.equal(r.chats[0].turns.length, 2);
  assert.equal(r.chats[0].turns[0].content, 'Go.');
  assert.equal(r.chats[0].turns[1].content, 'Done.');
});
test('generic: Me: / Bot: prefixes', () => {
  const md = 'Me: hello there\nBot: hello back\nMe: bye\nBot: later';
  const r = chatimport.parse(md);
  assert.deepEqual(r.chats[0].turns.map((t) => t.content), ['hello there', 'hello back', 'bye', 'later']);
});
test('generic: markers inside fenced code blocks never split turns', () => {
  const md = [
    '### Human',
    'Example follows:',
    '',
    '```',
    '### Human',
    '### AI',
    'not a turn',
    '```',
    '',
    '### AI',
    'Real answer.',
  ].join('\n');
  const r = chatimport.parse(md);
  const turns = r.chats[0].turns;
  assert.equal(turns.length, 2, JSON.stringify(turns));
  assert.ok(turns[0].content.includes('### Human'));
  assert.equal(turns[1].content, 'Real answer.');
});

// ---------- custom markers ----------
test('custom markers: explicit overrides parse any exporter, thinking marker included', () => {
  const md = [
    '## WRITE',
    'draft text',
    '## NOTES',
    'inner voice',
    '## REPLY',
    'final text',
  ].join('\n');
  const r = chatimport.parseCustom(md, {
    userMarker: '## WRITE', assistantMarker: '## REPLY', thinkMarker: '## NOTES', includeThinking: true,
  });
  assert.equal(r.format, 'custom');
  const turns = r.chats[0].turns;
  assert.deepEqual(turns.map((t) => t.role), ['user', 'assistant']);
  assert.equal(turns[0].content, 'draft text');
  assert.equal(turns[1].content, 'final text');
  assert.equal(turns[1].reasoning, 'inner voice');
});

// ---------- normalization ----------
test('normalization: consecutive same-role merge, empty drop, swapRoles', () => {
  const raw = [
    { role: 'user', content: 'part one' },
    { role: 'user', content: '' },
    { role: 'user', content: 'part two' },
    { role: 'assistant', content: 'reply' },
  ];
  const r = chatimport.normalizeTurns(raw, {});
  assert.equal(r.turns.length, 2);
  assert.equal(r.turns[0].content, 'part one\n\npart two');
  assert.ok(r.warnings.some((w) => w.includes('Merged 1 consecutive same-role turn')));
  assert.ok(r.warnings.some((w) => w.includes('Dropped 1 empty turn')));
  const swapped = chatimport.normalizeTurns([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }], { swapRoles: true });
  assert.deepEqual(swapped.turns.map((t) => t.role), ['assistant', 'user']);
});
test('normalization: leading assistant greeting kept with the provider warning', () => {
  const r = chatimport.normalizeTurns([{ role: 'assistant', content: 'greeting first' }, { role: 'user', content: 'ok' }], {});
  assert.equal(r.turns[0].role, 'assistant');
  assert.ok(r.warnings.some((w) => w.includes('assistant greeting')));
});
test('includeSystem off drops the export system prompt with a warning', () => {
  const j = JSON.stringify({ id: 'x', title: 'T', system: 'keep me', messages: [{ role: 'user', content: 'u' }] });
  const on = chatimport.parse(j, { includeSystem: true });
  assert.equal(on.chats[0].system, 'keep me');
  const off = chatimport.parse(j, { includeSystem: false });
  assert.equal(off.chats[0].system, undefined);
  assert.ok(off.chats[0].warnings.some((w) => w.includes('System prompt')));
});

// ---------- estimateTokens ----------
test('estimateTokens', () => {
  assert.equal(chatimport.estimateTokens('abcd'.repeat(4)), 4);
  assert.equal(chatimport.estimateTokens(''), 0);
});
