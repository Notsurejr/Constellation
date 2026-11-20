// Unit — compose.js: request assembly (system pile, lore placement, preserved-thinking
// depth, attachments incl. input_audio, macros, card re-injection, sliding window).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import compose from '../../src/js/compose.js';

const SYS = { role: 'system', content: 'base instructions' };
const baseOpts = { thinking: false, preservedThinking: false, sendAttachments: true };

test('buildSystem stacks roleplay, files, immersion and panes behind their gates', () => {
  const sys = compose.buildSystem({ roleplayPrompt: 'RP', systemFiles: [{ name: 'a.md', text: 'AAA' }], projectFiles: [], immersion: true, paneTeach: true });
  assert.ok(sys.startsWith('RP'));
  assert.ok(sys.includes('===== a.md (3 chars) ====='));
  assert.ok(sys.includes('# Prose typography'));
  assert.ok(sys.includes('# In-scene documents'));
  const bare = compose.buildSystem({ roleplayPrompt: 'RP', immersion: false, paneTeach: false });
  assert.ok(!bare.includes('# Prose typography'));
  assert.ok(!bare.includes('# In-scene documents'));
});

test('strict alternation preserved; system stays at [0]', () => {
  const list = [SYS, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }];
  const out = compose.toApiMessages(baseOpts, '', null, list);
  assert.equal(out[0].role, 'system');
  assert.deepEqual(out.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(out[1].content, 'u1');
});

test('preserved thinking: depth 0 echoes every assistant turn; depth N keeps only the last N', () => {
  const list = [SYS,
    { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1', reasoning: 'r1' },
    { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2', reasoning: 'r2' }];
  const all = compose.toApiMessages({ thinking: true, preservedThinking: true, preservedThinkingDepth: 0, sendAttachments: true }, '', null, list);
  assert.equal(all[2].reasoning_content, 'r1');
  assert.equal(all[4].reasoning_content, 'r2');
  const deep = compose.toApiMessages({ thinking: true, preservedThinking: true, preservedThinkingDepth: 1, sendAttachments: true }, '', null, list);
  assert.equal(deep[2].reasoning_content, undefined);
  assert.equal(deep[4].reasoning_content, 'r2');
  const off = compose.toApiMessages({ thinking: false, preservedThinking: true, preservedThinkingDepth: 0, sendAttachments: true }, '', null, list);
  assert.equal(off[2].reasoning_content, undefined);
});

test('send_attachments off: only the newest user message keeps its files; excluded files never reach the wire', () => {
  const f1 = { name: 'old.md', kind: 'text', text: 'OLD' };
  const f2 = { name: 'new.md', kind: 'text', text: 'NEW' };
  const f3 = { name: 'hid.md', kind: 'text', text: 'HID', excluded: true };
  const list = [SYS, { role: 'user', content: 'u1', files: [f1] }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2', files: [f2, f3] }];
  const off = compose.toApiMessages({ thinking: false, sendAttachments: false }, '', null, list);
  assert.ok(!off[1].content.includes('OLD'));
  assert.ok(off[3].content.includes('===== Attached file: new.md (3 chars) ====='), 'user-turn file block format');
  assert.ok(!off[3].content.includes('HID'));
  const on = compose.toApiMessages({ thinking: false, sendAttachments: true }, '', null, list);
  assert.ok(on[1].content.includes('OLD'));
  assert.ok(!on[3].content.includes('HID'));
});

test('image files become image_url parts; audio becomes input_audio with the mapped format', () => {
  const img = { name: 'p.png', kind: 'image', dataUrl: 'data:image/png;base64,IMGDATA' };
  const wav = { name: 'a.wav', kind: 'audio', dataUrl: 'data:audio/wav;base64,WAVDATA' };
  const webm = { name: 'b.webm', kind: 'audio', dataUrl: 'data:audio/webm;base64,WEBMDATA' };
  const list = [SYS, { role: 'user', content: 'look', files: [img, wav, webm] }];
  const out = compose.toApiMessages({ thinking: false, sendAttachments: true }, '', null, list);
  const parts = out[1].content;
  assert.equal(parts[0].type, 'text');
  assert.ok(parts[0].text.includes('look'));
  const imgPart = parts.find((p) => p.type === 'image_url');
  assert.equal(imgPart.image_url.url, 'data:image/png;base64,IMGDATA');
  const aud = parts.filter((p) => p.type === 'input_audio');
  assert.deepEqual(aud.map((p) => p.input_audio.format), ['wav', 'webm']);
  assert.equal(aud[0].input_audio.data, 'WAVDATA');
});

test('project fence prepends to a USER turn at the chosen depth (never an assistant turn)', () => {
  const list = [SYS, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' }];
  const out = compose.toApiMessages({ thinking: false, sendAttachments: true, projectDepth: 2, projectFenceTag: 'mystory' }, 'PROJECT RULES', null, list);
  assert.ok(out[1].content.startsWith('<mystory>'));
  assert.ok(out[1].content.includes('PROJECT RULES'));
  assert.ok(!out[2].content.includes('<mystory>'));
  assert.ok(out[3].content.includes('u2') && !out[3].content.startsWith('<mystory>'));
});

test('cache-safe lore: constants stay in the system pile; dynamic hits ride the newest user turn ABOVE the fence', () => {
  const list = [SYS, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'story beat' }];
  const loreCtx = { items: [
    { label: 'ConstA', text: 'constant facts', constant: true },
    { label: 'DynB', text: 'dynamic facts', constant: false },
  ] };
  const out = compose.toApiMessages({ thinking: false, sendAttachments: true, cacheSafeLore: true, projectDepth: 0, projectFenceTag: 'project_instructions' }, 'PROJ RULES', loreCtx, list);
  const sys = out[0].content;
  const newest = out[3].content;
  assert.ok(sys.includes('# World'));
  assert.ok(sys.includes('<lore:ConstA>'));
  assert.ok(!sys.includes('DynB'));
  const atLore = newest.indexOf('<lore:DynB>');
  const atFence = newest.indexOf('<project_instructions>');
  const atStory = newest.indexOf('story beat');
  assert.ok(atLore !== -1 && atFence !== -1 && atStory !== -1);
  assert.ok(atLore < atFence && atFence < atStory, 'lore → fence → story');
});

test('default (non-cache-safe) lore: everything lands in the system pile', () => {
  const list = [SYS, { role: 'user', content: 'u1' }];
  const loreCtx = { items: [
    { label: 'ConstA', text: 'constant facts', constant: true },
    { label: 'DynB', text: 'dynamic facts', constant: false },
  ] };
  const out = compose.toApiMessages({ thinking: false, sendAttachments: true, cacheSafeLore: false }, '', loreCtx, list);
  assert.ok(out[0].content.includes('<lore:ConstA>'));
  assert.ok(out[0].content.includes('<lore:DynB>'));
  assert.equal(out[1].content, 'u1');
});

test('depth lore rides a user turn N up from the bottom, snapped past assistant turns', () => {
  const list = [SYS, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' }];
  const one = compose.toApiMessages({ thinking: false, sendAttachments: true }, '', { items: [{ label: 'One', text: 'one facts', depth: 1 }] }, list);
  assert.ok(one[0] && !one[0].content.includes('<lore:One>'), 'depth entries skip the system pile');
  assert.ok(one[3].content.includes('<lore:One>'), 'depth 1 = the newest user turn');
  assert.ok(!one[4].content.includes('<lore:One>'));
  const two = compose.toApiMessages({ thinking: false, sendAttachments: true }, '', { items: [{ label: 'Deep', text: 'deep facts', depth: 3 }] }, list);
  assert.ok(two[1].content.includes('<lore:Deep>'), 'depth 3 lands on u1 (snapped past a1)');
  assert.ok(!two[2].content.includes('<lore:Deep>'), 'never rides an assistant turn');
  assert.ok(!two[3].content.includes('<lore:Deep>'));
});

test('card re-injection tripwire: depth > 0 AND est tokens >= trigger, marker dedup holds', () => {
  const filler = 'word '.repeat(6000);   // ~30k chars → ~7.5k est tokens
  const list = [SYS, { role: 'user', content: filler }, { role: 'assistant', content: filler }, { role: 'user', content: filler }, { role: 'assistant', content: filler }];
  const opts = { thinking: false, sendAttachments: true, cardReinject: 2, cardReinjectAt: 5000, cardBlock: 'CARD BLOCK', personaBlock: 'PERSONA BLOCK' };
  const fired = compose.toApiMessages(opts, '', null, list);
  const target = fired[3].content;   // depth 2 → out.length - 2 → snapped to the user turn there
  assert.ok(target.includes('<lore:card recall>'), 'recall fence lands on the depth target user turn');
  assert.ok(target.includes('CARD BLOCK') && target.includes('PERSONA BLOCK'));
  assert.ok(!fired[4].content.includes('<lore:card recall>'));
  const already = compose.toApiMessages(Object.assign({}, opts), '', null, [
    list[0],
    { role: 'user', content: filler },
    { role: 'assistant', content: filler },
    { role: 'user', content: '<lore:card recall>\nold\n\n' + filler },
    { role: 'assistant', content: filler },
  ]);
  assert.equal(already[3].content.split('<lore:card recall>').length - 1, 1, 'marker dedup: no double injection on the target turn');
  const under = compose.toApiMessages({ thinking: false, sendAttachments: true, cardReinject: 2, cardReinjectAt: 999999, cardBlock: 'CARD' }, '', null, list);
  assert.ok(!under[1].content.includes('<lore:card recall>'), 'under the trigger → never fires');
});

test('macro cast-gate: cast chats substitute, regular chats keep syntax verbatim; older turns are frozen', () => {
  const list = [Object.assign({}, SYS, { content: 'base {{turn}} instructions' }),
    { role: 'user', content: 'old {{turn}} turn' }, { role: 'assistant', content: 'a' },
    { role: 'user', content: 'roll {{roll:1d6}} pick {{random:x,y}} at {{time}} on {{date}}' }];
  const cast = compose.toApiMessages({ thinking: false, sendAttachments: true, castMacros: true }, '', null, list);
  assert.ok(!cast[0].content.includes('{{turn}}'), 'system macros refresh every send');
  assert.ok(!cast[1].content.includes('{{turn}}') === false || cast[1].content.includes('{{turn}}'), 'OLDER user turns stay frozen (their macro was resolved at their own send)');
  assert.ok(cast[1].content.includes('{{turn}}'));
  const rolled = cast[3].content;
  assert.ok(!rolled.includes('{{roll:1d6}}') && !rolled.includes('{{random:x,y}}') && !rolled.includes('{{time}}') && !rolled.includes('{{date}}'));
  const die = rolled.match(/(\d+)/);
  assert.ok(die && +die[1] >= 1 && +die[1] <= 6);
  const regular = compose.toApiMessages({ thinking: false, sendAttachments: true, enableMacros: false }, '', null, list);
  assert.ok(regular[3].content.includes('{{roll:1d6}}'), 'regular chats never substitute');
  assert.ok(regular[0].content.includes('{{turn}}'));
  const optedIn = compose.toApiMessages({ thinking: false, sendAttachments: true, enableMacros: true }, '', null, list);
  assert.ok(!optedIn[0].content.includes('{{turn}}'), 'enable_macros opts regular chats in');
});

test('trimForApi keeps system + latest, drops the oldest middle, and never leads with an assistant turn', () => {
  const chunk = 'w'.repeat(400);   // 100 est tokens each
  const list = [SYS,
    { role: 'user', content: chunk }, { role: 'assistant', content: chunk },
    { role: 'user', content: chunk }, { role: 'assistant', content: chunk },
    { role: 'user', content: chunk }, { role: 'assistant', content: 'final ' + chunk }];
  const out = compose.trimForApi(600, list);
  assert.equal(out[0].role, 'system');
  assert.ok(out.length < list.length, 'trimmed something');
  assert.equal(out[out.length - 1].content.slice(0, 6), 'final ');
  assert.equal(out[1].role, 'user');
});

test('estTokens + lastUserIndex basics', () => {
  assert.equal(compose.estTokens([{ content: 'abcd'.repeat(3) }]), 3);
  assert.equal(compose.lastUserIndex([{ role: 'system' }, { role: 'assistant' }, { role: 'user', content: 'x' }]), 2);
  assert.equal(compose.lastUserIndex([{ role: 'system' }]), -1);
});
