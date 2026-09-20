// Unit test: mdexport.chatToMarkdown against the approved Obsidian-callout format.
const { chatToMarkdown, safeFileTitle, prettyModel } = require('./mdexport');

const msgs = [
  { role: 'system', content: 'you are a GM' },
  { role: 'user', content: 'Hello V are you ready?\nSecond line here.' },
  { role: 'assistant', content: '', reasoning: 'Let me think about tone first.\nAnd a second reasoning line.' },
  { role: 'assistant', content: 'Ready, Boss.\n\nNew paragraph after a blank.', reasoning: 'tone set' },
  { role: 'user', content: 'Do the thing "quoted" \\ backslash' },
  { role: 'assistant', content: 'edited wording', orig: 'original wording', edited: true },
];

const md = chatToMarkdown({ title: 'My "quoted" chat', messages: msgs, model: 'glm-5.3', system: 'you are a GM' }, { thinking: true, system: true });
console.log(md);
console.log('================ CHECKS ================');
const checks = [
  ['frontmatter present', md.startsWith('---\ntitle: "My \\"quoted\\" chat"')],
  ['app tag', md.includes('app: Constellation')],
  ['model tag', md.includes('model: glm-5.3')],
  ['messages count excludes system', md.includes('messages: 5')],
  ['user callout', md.includes('> [!QUESTION] User\n> Hello V are you ready?\n> Second line here.')],
  ['blank line inside callout is bare >', md.includes('> Ready, Boss.\n>\n> New paragraph after a blank.')],
  ['standalone thinking callout folded', md.includes('> [!abstract]- ✦ Thinking\n> Let me think about tone first.\n> And a second reasoning line.')],
  ['model label pretty', md.includes('> [!NOTE] GLM-5.3\n> Ready, Boss.')],
  ['edited marker', md.includes('> [!NOTE] GLM-5.3 · ✎ edited\n> edited wording')],
  ['system prompt folded', md.includes('> [!quote]- ✦ System prompt\n> you are a GM')],
  ['no raw reasoning leaks as prose', !md.includes('\ntone set\n')],
];
let fail = 0;
for (const [name, ok] of checks) { console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name); if (!ok) fail++; }

const mdNoThink = chatToMarkdown({ title: 't', messages: msgs, model: 'glm-5.3' }, { thinking: false });
const checks2 = [
  ['thinking off: no abstract callouts', !mdNoThink.includes('[!abstract]')],
  ['thinking off: replies still present', mdNoThink.includes('> [!NOTE] GLM-5.3')],
  ['thinking off: no system callout', !mdNoThink.includes('[!quote]')],
];
for (const [name, ok] of checks2) { console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name); if (!ok) fail++; }

console.log('safeFileTitle =', JSON.stringify(safeFileTitle('a/b:c*d?"e<f>g|h#')));
console.log('prettyModel: glm-5.3 ->', prettyModel('glm-5.3'), '| openrouter/qwen ->', prettyModel('openrouter/qwen'), '| empty ->', prettyModel(''));
const empty = chatToMarkdown({ title: 'empty', messages: [], model: 'glm-5.3' }, {});
console.log('empty chat still valid frontmatter:', empty.startsWith('---') && empty.includes('messages: 0'));
process.exit(fail ? 1 : 0);
