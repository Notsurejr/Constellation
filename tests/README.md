# Constellation test suite

Three layers, all wired to npm scripts. No test-framework dependencies — `node:test` and
`node:assert/strict` only, Node 20+ compatible (CI runs Node 20).

| Script | Layer | Needs Electron? |
|---|---|---|
| `npm run test:unit` | `tests/unit/` — pure-Node units: lore engine, compose, card compiler, PNG card parser + settings spec (`src/js/mainutil.js`), markdown export | no |
| `npm run test:e2e` | `tests/e2e/` — boots the real app against `lab/mock-server.mjs` in an ISOLATED profile and drives it over CDP: boot health gate, full-shape fixture, feature regressions, streaming | yes |
| `npm run test:chaos` | `tests/chaos/` — hostile inputs: XSS/injection vectors, malformed cards/files/ids, broken network + UI races, against a disposable profile | yes |

`npm run test:all` runs all three in order.

## Isolation rules

- The e2e/chaos layers launch with `CONSTELLATION_USER_DATA` pointed at their own disposable
  profile (see `helpers/`) — the shared `.lab-sandbox/`, the installed app, and
  `%AppData%\constellation` are never touched.
- e2e uses its own ports (app CLI `7333`, mock `7391`) so it can never collide with the
  shared lab (`7332`/`7390`) or the installed app (`7331`).
- Chaos spawns its OWN hostile mock on `7392`; it never sends anything to a real provider.
- The mock scenarios for e2e live in `lab/mock-server.mjs` (shared fixture, marker-gated);
  chaos keeps its hostile server inside `tests/chaos/`.

## Production-code contract

`src/js/mainutil.js` is pure Node (no Electron imports) — it is the ONLY renderer/main
module the unit suite may import besides the UMD/CommonJS modules that already exported
themselves (`engines.js`, `compose.js`, `cardcompile.js`, `mdexport.js`). Everything else
(needs DOM or Electron) is covered by e2e/chaos.
