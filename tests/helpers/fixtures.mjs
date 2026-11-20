// e2e helper — profile staging + the full-shape fixture session.
// Every structural message shape in one chat: text/image/audio attachments, variants,
// preserved thinking, sculpt edit, cast metadata + re-injection, bookmarks, model stamps,
// dialogue, color words, grammar marks and every pane fence.
import fs from 'node:fs';
import path from 'node:path';
import { E2E_MOCK_PORT } from './mock.mjs';

export const E2E_CLI_PORT = 7333;   // app CLI port — namespace-isolated from lab (7332) and installed (7331)
export const FIXTURE_ID = 'e2efixture';

export const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const TINY_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const reasoning = (n) => 'Reasoning pass ' + n + ': weigh the lamp motif, keep the reveal one beat later than comfortable, watch cadence. '.repeat(6);

function buildMessages() {
  return [
    { role: 'user', content: 'Open on the Hold. Third watch, fog on the glass.' },
    {
      role: 'assistant', content: [
        'The amber lamplight caught her as she turned — a long beat of nothing, then the quiet.',
        '',
        '“You brought the chart,” she said. “The cobalt ink is still wet. Don’t smudge it.”',
        '',
        'He was measured about it — 5\'10" of careful silence, the emerald needle settled.',
        '',
        '@ The Hold · Third Watch',
        '',
        '... silence settles',
        '',
        '```placard',
        'LIGHTHOUSE END',
        'PORT AUTHORITY — BERTH 9',
        'All vessels must log cargo and crew before dawn.',
        '```',
        '',
        '```comms',
        '[04:19] Helm :: heading true',
        'Vex: “Hold her steady.”',
        '```',
        '',
        '```hud',
        'HULL: 82%',
        '[|||.......]',
        '[LOCKED]',
        '```',
      ].join('\n'),
      reasoning: reasoning(1), model: 'mock-1',
      lore: [{ label: 'Lighthouse End · background', text: 'The Hold is a salvage tug at berth 9.' }],
    },
    { role: 'user', content: 'Explain the reason the ledger skipped a beat, and take the standing orders into account.', files: [{ name: 'standing-orders.md', kind: 'text', text: 'Keep the prose tight.\n'.repeat(40) }] },
    {
      role: 'assistant', content: 'The **chart** settled the question — *mostly*. ** “spoken words” ** arrived later.',
      reasoning: reasoning(2), model: 'mock-1', edited: true, orig: 'The chart settled the question.',
      variants: [
        { content: 'variant A take', reasoning: reasoning('A'), model: 'mock-1' },
        { content: 'variant B take', reasoning: reasoning('B'), model: 'mock-1' },
        { content: 'The **chart** settled the question — *mostly*. ** “spoken words” ** arrived later.', reasoning: reasoning(2), model: 'mock-1' },
      ],
      vActive: 2,
    },
    { role: 'user', content: 'Here is the hull photo and the watch recording.', files: [
      { name: 'hull.png', kind: 'image', dataUrl: TINY_PNG },
      { name: 'watch.wav', kind: 'audio', dataUrl: TINY_WAV },
    ] },
    {
      role: 'assistant', content: [
        'The watch recording hums. ++Helm, hold course++ — the needle obeyed.',
        '',
        '^^A lifted, melodic line^^ came down from the bridge, and the crew looked up.',
        '',
        '!! All hands to the chart table !!',
        '',
        '```verse',
        'We charted the deep and the deep charted us,',
        'two inks on one page, one heading, one trust.',
        '```',
        '',
        '```note',
        'The key is where we said — under the third lantern.',
        '',
        '— V., third shift',
        '```',
        '',
        '```news',
        'THE LANTERN LEDGER · 12th of Frost',
        'PORT FEES RISE AGAIN',
        'Berth nine vessels face a doubled levy from the first thaw.',
        '```',
        '',
        '```memory',
        'The fog remembered a different ship, once, and kept its shape.',
        '```',
        '',
        '```diff',
        '- course: the long way around the Shoals',
        '+ course: through the Shoals, at slack water',
        '```',
        '',
        '```file',
        'CARGO MANIFEST 9-A',
        ' barrels: 12 ||condition: salted||',
        '```',
        '',
        '```log',
        '[04:19:44] the crew ........... seven aboard and one very quiet stowaway who reads over shoulders and leaves the lanterns trimmed, which is either kindness or reconnaissance, and the log does not venture an opinion on which',
        '```',
        '',
        'A [long pause] while the {{warp}} hummed below — ||the part about the stowaway|| stayed behind their teeth.',
      ].join('\n'),
      reasoning: reasoning(3), model: 'mock-1',
    },
  ];
}

// Stage the disposable profile: config, display filters, the fixture session, bookmarks.
export function stageProfile(profileDir) {
  const config = path.join(profileDir, 'config');
  const data = path.join(profileDir, 'data');
  fs.mkdirSync(path.join(config, 'modes'), { recursive: true });
  fs.mkdirSync(path.join(data, 'sessions'), { recursive: true });

  fs.writeFileSync(path.join(config, 'connections.json'), JSON.stringify({
    active: 'c_mock',
    list: [{ id: 'c_mock', name: 'E2E Mock', baseUrl: `http://127.0.0.1:${E2E_MOCK_PORT}/v1`, models: [{ id: 'mock-1', label: 'Mock Streamer' }], activeModel: 'mock-1' }],
  }, null, 2), 'utf8');

  fs.writeFileSync(path.join(config, 'settings.txt'), [
    '# e2e profile settings',
    'api_key:',
    'model: mock-1',
    'base_url: http://127.0.0.1:' + E2E_MOCK_PORT + '/v1',
    'temperature: 0.8',
    'top_p: 0.95',
    'thinking: off',
    'stream_cps: 400',
    'stream_ink: on',
    'dialogue_style: chiaroscuro',
    'color_words: on',
    'fx_events: on',
    'glass_style: smoked',
    'code_pane_style: recessed',
    'response_window: void',
    'context_window: 0',
    '',
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(config, 'display-filters.txt'), '/the reason/ => the cause\n', 'utf8');

  const msgs = buildMessages();
  fs.writeFileSync(path.join(data, 'sessions', FIXTURE_ID + '.json'), JSON.stringify({
    id: FIXTURE_ID, title: 'E2E Fixture', messages: msgs,
    system: 'You are the narrator of a salvage-tug story.',
    project: 'Keep the prose tight.',
    systemFiles: [], projectFiles: [],
    gen: { model: 'mock-1', provider: '', temperature: 0.8, topP: 0.95, maxTokens: 0, thinking: false, reasoningEffort: 'max', streamCps: 400, contextWindow: 0, preservedThinking: true, sendAttachments: true },
    usage: { tokens: 4200, requests: 3 },
    pinned: false, hidden: false,
    projectFence: 'project_instructions',
    cardBlock: 'E2E CARD BLOCK — Fixturechar, keeper of the lighthouse ledger.',
    personaBlock: 'E2E PERSONA BLOCK — the archivist on watch.',
    cardReinject: 3, cardReinjectAt: 5000,
    parentId: null, parentTitle: null, folder: null, lore: [],
    character: { id: 'e2e-char-000', name: 'Fixturechar' },
    updatedAt: Date.now(),
  }, null, 2), 'utf8');

  fs.writeFileSync(path.join(data, 'bookmarks.json'), JSON.stringify([
    { id: 'b_e2e_1', chatId: FIXTURE_ID, chatTitle: 'E2E Fixture', msgIndex: 1, head: 'The amber lamplight caught her', role: 'assistant', ts: Date.now() - 1000 },
  ]), 'utf8');

  return { fixtureMessages: msgs };
}

// A minimal second chat for switch tests.
export function stageSmallChat(profileDir) {
  fs.mkdirSync(path.join(profileDir, 'data', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'data', 'sessions', 'e2esmall.json'), JSON.stringify({
    id: 'e2esmall', title: 'E2E Small', messages: [
      { role: 'user', content: 'Quick reference chat.' },
      { role: 'assistant', content: 'Short answer, one color word: emerald.', model: 'mock-1' },
    ],
    gen: { model: 'mock-1', streamCps: 400 }, usage: { tokens: 50, requests: 1 },
  }, null, 2), 'utf8');
}
