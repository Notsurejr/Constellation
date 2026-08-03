# Constellation — Build Specification

**Version:** 0.1.0 · **Platform:** Windows (Electron) · **Target provider:** GLM (Zhipu AI / Z.ai), provider-agnostic by design

A desktop application that wraps a user-supplied LLM API key and *steers/formats* the model for three purposes:

1. **Roleplay** — streamed chat sessions.
2. **Creative writing** — prose generation/refinement.
3. **Craft mode** — a writing coach that reviews the user's own writing and accumulates lessons in a journal.

The app is a **client**, not a model: it holds no intelligence of its own. It packages, steers, and renders a model that runs on the provider's servers.

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Desktop runtime | **Electron 31** | Real installable app from web tech; full visual control; one language end-to-end. |
| Renderer | **Vanilla JS** (no framework, no build step) | Readable; zero compilation; easy for a non-programmer to follow. |
| LLM client | **`openai` SDK v4** (CommonJS) pointed at GLM's OpenAI-compatible endpoint | Standard, well-tested streaming. |
| Markdown | **`marked`** (vendored UMD) + a small DOM sanitizer | Live formatting of model output. |
| Packaging | **electron-builder** (NSIS target) | Double-clickable Windows installer. |
| Persistence | Plain text + JSON in the OS user-data folder | Survives reinstalls/updates; editable by hand. |

Node/npm are required to develop and build; the shipped `.exe` has no runtime dependencies.

---

## 2. Architecture

A strict three-layer split. This is the most important idea in the codebase — it keeps the API key and all network access out of the untrusted UI.

```
┌──────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (main.js)            Node, full privileges      │
│  • holds the API key                                          │
│  • all network calls (openai SDK)                             │
│  • file I/O (config, sessions, presets, journal)             │
│  • native dialogs, window, spellcheck menu                   │
└───────────────▲──────────────────────────────┬───────────────┘
                │ IPC (ipcMain.handle)          │ contextBridge
┌───────────────┴──────────────────────────────▼───────────────┐
│  PRELOAD (preload.js)             contextIsolation: on        │
│  exposes a small, fixed window.api surface only               │
└───────────────▲──────────────────────────────────────────────┘
                │ window.api.*
┌───────────────┴──────────────────────────────────────────────┐
│  RENDERER (src/**)                untrusted, sandboxed UI     │
│  • never sees the key                                         │
│  • asks the main process to do anything privileged            │
└──────────────────────────────────────────────────────────────┘
```

**Window settings:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, plus a strict Content-Security-Policy:
`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';`

The renderer is structured as small modules that attach to a shared global namespace:
```js
var Constellation = window.Constellation || (window.Constellation = {});
Constellation.chat = (function () { ... })();
```
> ⚠️ The alias **must use `var`, not `const`**. A second `const Constellation` throws "Identifier has already been declared" and silently kills that script. (See §10 Gotchas.)

**Boot order** (`app.js`, on `DOMContentLoaded`): apply saved appearance → `settings.init()` → `sessions.init()` → `craft.init()` → `chat.init()` → focus the input.

---

## 3. Project structure

```
Constellation/
├── package.json              # metadata, scripts (start/dist), build config
├── main.js                   # Electron main: all IPC + API calls + window
├── preload.js                # secure window.api bridge
├── build/
│   ├── icon.ico              # app icon (multi-size, embedded in .exe + window)
│   └── icon-render.js        # pure-JS generator that produced icon.ico (re-runnable)
├── src/
│   ├── index.html            # the app screen + Settings/Craft overlays
│   ├── lib/
│   │   └── marked.umd.js     # vendored markdown parser (loaded as a local <script>)
│   ├── styles/
│   │   ├── theme.css         # ★ tweakable look (CSS variables: colors, fonts, widths)
│   │   └── app.css           # layout, bubbles, overlays, animations
│   └── js/
│       ├── starfield.js      # canvas starfield (parallax, cached glow, pauses when hidden)
│       ├── md.js             # markdown render + sanitizer (stateless, shared)
│       ├── chat.js           # conversation, streaming, edit/regen, attachments, usage
│       ├── settings.js       # Settings overlay (presets, prompts, connection, generation, appearance)
│       ├── sessions.js       # saved-chats sidebar (list/load/rename/delete)
│       ├── craft.js          # writing-coach mode + journal
│       └── app.js            # boots the renderer
├── config/                   # shipped defaults (copied into userData on first run)
│   ├── settings.txt
│   ├── project.txt
│   └── modes/{roleplay,creative,craft}.txt
├── data/                     # shipped default data (sessions/presets/journal) — seeded on first run
└── dist/                     # build OUTPUT (disposable; regenerated by `npm run dist`)
    ├── Constellation Setup 0.1.0.exe   # the NSIS installer
    └── win-unpacked/                   # the packaged app as a folder
```

---

## 4. Runtime data & configuration

At runtime, all writable state lives in the OS user-data folder — **never inside the read-only packaged `app.asar`**. On Windows that is `%AppData%\constellation\`:

```
%AppData%\constellation\
├── config\
│   ├── settings.txt        # key/value (see below)
│   ├── project.txt         # per-project instructions
│   └── modes\              # system prompts per mode (roleplay/creative/craft)
├── data\
│   ├── sessions\*.json     # saved chats
│   ├── presets\*.json      # saved system+project prompt sets
│   └── craft_journal.txt   # accumulated craft takeaways
└── window-state.json       # last window size
```

On first launch, `copyTreeIfMissing()` seeds `config/` and `data/` from the shipped defaults, and writes a blank `settings.txt` if none exists. Existing files are never overwritten.

### `settings.txt` keys

Parsed as `key: value` lines; `#` lines are comments.

| Key | Meaning | Default |
|---|---|---|
| `api_key` | GLM API key (main-process only) | _(empty)_ |
| `model` | Model id (e.g. `glm-5.2`) | `glm-5.2` |
| `base_url` | Provider endpoint | coding endpoint |
| `temperature` | Sampling temperature | `0.8` |
| `top_p` | Nucleus sampling | `0.95` |
| `max_tokens` | Max reply length (`0` = omit) | `4096` |
| `thinking` | `on`/`off` — emit/forward reasoning | `off` |
| `reasoning_effort` | Thinking depth on GLM-5.2+: `max`/`high`/`minimal` | `max` |
| `context_window` | Max tokens of history sent (`0` = unlimited) | `0` |
| `font_scale` | UI text scale (0.8–1.6) | `1` |
| `chat_width` | Centered chat column width, px (600–1500) | `880` |
| `accent` | Accent color, `#rrggbb` (empty = default blue) | _(empty)_ |
| `stream_cps` | Text reveal rate, chars/sec (`0` = instant) | `0` |
| `star_density` | Starfield density multiplier (0.2–2.5) | `1` |
| `twinkle_speed` | Star twinkle multiplier (`0` = frozen) | `1` |

### File formats

**Session** (`data/sessions/<id>.json`)
```json
{ "id": "s_...", "title": "...", "updatedAt": 0,
  "gen"?: { "model","temperature","topP","maxTokens","thinking","reasoningEffort","streamCps","contextWindow" },
  "system"?: "...", "project"?: "...",
  "messages": [ { "role": "user|assistant", "content": "...", "reasoning"?: "...", "files"?: [{"name","size","text"}] } ] }
```
Each chat carries its own `gen` (generation settings), `system`, and `project` — all restored on load and edited per-chat in Settings; new chats start from global defaults, older chats without them fall back to those defaults. The optional `reasoning` (assistant only) holds the model's `reasoning_content` so the ✦ Thinking block survives a restart; with thinking on it's also returned to the API for Preserved Thinking (see §6).
**Preset** (`data/presets/<id>.json`): `{ "id", "name", "system", "project" }`

---

## 5. The `window.api` surface (preload bridge)

The renderer can call **only** these; nothing else is exposed.

| Method | Purpose |
|---|---|
| `loadConfig()` / `saveConfig(patch)` | read/write `settings.txt` |
| `loadModes()` / `saveMode(name, content)` | system-prompt files |
| `loadProject()` / `saveProject(content)` | project instructions |
| `listSessions` / `loadSession(id)` / `saveSession(data)` / `deleteSession(id)` / `renameSession(id, title)` | saved chats |
| `listPresets` / `loadPreset(id)` / `savePreset(data)` / `deletePreset(id)` | prompt presets |
| `loadCraftJournal()` / `appendCraftJournal(line)` | craft journal |
| `exportMarkdown(defaultName, content)` | save chat → `.md`/`.txt` via native dialog |
| `chatStream(messages, opts, {onChunk, onDone, onError, onRetry, onThink})` | streamed completion |

---

## 6. Streaming pipeline

**Main process** (`chat:stream`):
1. Builds an `openai` client from settings (`apiKey`, `baseURL`, `maxRetries: 0`).
2. Retries the initial request up to **4 attempts** on transient errors (see §7); gives up immediately on billing errors.
3. Iterates the async stream, forwarding each chunk to the renderer:
   - `delta.content` → `chat:chunk` with `kind: 'text'`
   - `delta.reasoning_content` → `chat:chunk` with `kind: 'think'`
4. Ends with `chat:done { full }` or `chat:error { message }`.

When `thinking` is on, the request includes `thinking: { type: 'enabled' }`.

**Renderer** (`chat.js → streamReply`):
- Reveals text via a `requestAnimationFrame` "typewriter pump" at `opts.streamCps` chars/sec (`Infinity` = instant). Markdown is re-parsed on a ~40 ms throttle as the revealed prefix grows.
- **Smart scroll:** only auto-follows the stream when the reader is already near the bottom; if they scrolled up to read, their place is preserved and a **↓ jump-to-latest** button appears.
- On completion: the caret is removed, the final markdown is rendered, a **word/char count** footer is filled, and the chat **auto-saves**.
- **Stop / Continue / Copy:** the send button becomes a **Stop** button during generation (aborts the stream via an `AbortController` + `chat:cancel`; partial text is kept). The final chunk's `finish_reason` is forwarded in `chat:done` — when it's `'length'` (cut off by `max_tokens`), a **Continue** action appears on that message and sends a follow-up "continue" turn. **Copy** (⎘) on any message copies its raw markdown; code blocks get their own copy button.
- **Reasoning is persisted & preserved:** `reasoning_content` collected during the stream is stored verbatim on the assistant message (`reasoning`) so the ✦ Thinking block is restored when the chat is reopened. When thinking is on, `toApiMessages` also returns each prior turn's `reasoning_content` **verbatim** (GLM **Preserved Thinking**, requested as `thinking:{type:'enabled', clear_thinking:false}`) so reasoning carries across turns; the context meter counts it. Turn thinking off to stop sending it.

### Retry policy (`isRetryable`)
- **Skip** (won't retry): billing/quota errors — `/余额|insufficient.*(balance|quota|credit)/i`, and any 401.
- **Retry**: HTTP 429, 5xx, 408, 409, and network errors with no status.
- **Backoff:** `min(8000, 800 · 2^(attempt-1))` ms → ~0.8 s, 1.6 s, 3.2 s.

---

## 7. Subsystems

### Markdown (`renderMarkdown`)
`marked.parse(src, { gfm:true, breaks:true })` → parsed into an inert `<template>` → a DOM-tree-walker **sanitizer** strips `<script>/<iframe>/<object>/...`, all `on*` attributes, and `javascript:`/`vbscript:`/`data:text/html` URLs → returned as safe HTML. Falls back to escaped text if `marked` is absent.

### Code blocks (`enhanceCodeBlocks`)
Once a message is fully rendered (after streaming, or on load), each `<pre>` is wrapped in a `.codeblock` "card" with an **Expand/Collapse** toggle. Collapsed (default) = horizontal scroll as before; **Expand** flips the `pre` to `white-space: pre-wrap` + `overflow-wrap: anywhere` so wide blocks wrap to the window and read top-to-bottom without scrolling sideways. Injected only on the final render (not during the throttled streaming re-parses), and re-applied when a message is restored after editing.

### File attachments
A 📎 button + drag-and-drop read selected files as text (`FileReader`), shown as chips with name + char count (amber tint > 50 k chars). On send, each file's text is inlined into the user message behind a clear delimiter (`===== Attached file: name (N chars) =====`) via `toApiMessages()`. Attachments persist in the saved session and survive edits/regenerates.

### Sessions (`sessions.js`)
Sidebar lists saved chats sorted by recency. **Titles persist**: the first message auto-derives a title, but once set (or renamed), later auto-saves keep it instead of re-deriving. Rename via inline ✎ (Enter saves / Esc cancels) through a `sessions:rename` IPC.

### Settings (`settings.js`)
Sections: **Presets**, **System instructions (roleplay)**, **Project instructions**, **Connection** (API key, model, endpoint picker), **Generation** (creativity, max length, thinking, **text flow speed**), **Appearance** (text size, chat width, **accent color**). The ✦ star **toggles** the panel open/closed; it does **not** close on click-away (to protect in-progress edits). Close button + `Esc` also close.

### Appearance theming
Driven by CSS custom properties set at runtime on `:root`:
- `--font-scale` (scales message + input text)
- `--chat-col` (width of the centered conversation column; bubbles are `0.75 × --chat-col`, so user-right / GLM-left bubbles reach across the centerline)
- `--accent` + derived `--accent-dim`, `--user-bubble`, `--glow` (recomputed from one hex)

Applied on startup (`app.js`) and live in Settings. The OS window size is persisted to `window-state.json` and restored on launch.

### Craft mode (`craft.js`)
"Pull my writing from current chat" copies the user's typed messages into a textarea; **Analyze** sends them with `modes/craft.txt` as the system prompt and streams the review. A regex (`/Craft takeaway:\s*(.+)/i`) extracts any takeaway line and appends it to the craft journal.

### Spellcheck
Electron's built-in spellchecker draws the red underline; a `webContents('context-menu')` handler in `main.js` builds a `Menu` offering correction suggestions (`replaceMisspelling`), **Add to dictionary** (`session.addWordToSpellCheckerDictionary`), and Copy/Paste.

### Starfield (`starfield.js`)
A fixed `<canvas>` behind everything: true-black field, pinpoint stars, per-star twinkle phase, very slow drift, and **pointer parallax** (stars sit in random depth layers and shift with the mouse for a sense of real space). Density and twinkle are runtime-tunable via `Constellation.starfield.setDensity/setTwinkle`, surfaced as Appearance sliders and persisted as `star_density`/`twinkle_speed`. One canvas, `requestAnimationFrame`, lightweight.

### Visual polish
- **Reading-progress hairline** — a 2px starlight bar down the right edge tracks scroll position through the chat (`updateReadProgress`; hidden when there's nothing to scroll).
- **Speaker glyphs** — ✦ beside GLM, ✧ beside You, in each message's role label.
- **Status breathe** — the `connected` status slowly pulses opacity, only when idle.
- **Zen mode** — `body.zen` (☾ button / Esc) fades the top bar (hover the top edge to recall it), force-closes the sidebar, and widens the conversation column via `--chat-col`.

---

### Per-chat settings, context window, and fork
- **Per-chat settings**: generation (`model`, temperature, nucleus, max length, thinking + effort, flow speed, context window) lives in a `gen` object on each session, restored on load (older chats fall back to global config). Settings → Generation reads/writes the active chat; saving also updates the global default for new chats. Connection (key/endpoint) + Appearance stay global.
- **Sliding context window** (`trimForApi`): when `contextWindow > 0`, the oldest middle turns are dropped from the request (system message + latest turn always kept) until the chars/4 estimate fits — saved history is never touched. The context meter then reads `◐ sent / total` and scales warm/hot to the window.
- **Fork** (⑂ on any message): `forkFromEl` snapshots the conversation prefix non-destructively; `sessions.forkFrom` creates a new chat carrying the parent's `system`/`project`/`gen`. The original chat is untouched.

### Sidebar: search, pin, model switcher, draft
- **Search** (`sessions:search`) scans every session's title + message content server-side; the sidebar shows matches with a snippet, and loading one calls `chat.scrollToMatch` to scroll to + flash the hit.
- **Pin** — a `pinned` flag on the session, sorted first by `sessions:list` and preserved across auto-saves; ☆ toggle per item.
- **Quick model switcher** (`#topModel` in the top bar) calls `setOptions({model})` + `persist()`; `setOptions` keeps the dropdown in sync with the active chat's model.
- **Draft autosave** (`data/drafts.json`, a map of sessionId → text) — saved debounced on input, restored on load, cleared on send / new chat.

### Lineage, usage, and backup
- **Fork lineage** — a fork stores `parentId`/`parentTitle`; the sidebar shows `↳ ⟨parent⟩`. Preserved across auto-saves.
- **Usage tracker** — `chat.js` accumulates an estimated token count per chat (request via `estTokens(trimForApi(...))` + reply chars/4), stored as `usage: {tokens, requests}` on the session; the sidebar shows per-chat usage and a grand total in `#sidebarFoot`.
- **Backup / restore** (`backup:export`, `backup:import`) — bundles config (settings/project/modes), all sessions, presets, drafts, and the craft journal into one JSON via native dialogs; restore clears sessions/presets and writes the bundle, then the app reloads.

---

## 8. GLM integration specifics

- **OpenAI-compatible** chat-completions API via the `openai` SDK.
- A **GLM Coding Plan** key requires the dedicated **coding endpoint** `https://api.z.ai/api/coding/paas/v4`. The general `open.bigmodel.cn` endpoint returns `429 余额不足` for such keys. An endpoint picker is exposed in Settings.
- **Context caching is automatic** on Z.ai (cached prefix tokens billed ~50%); no client setting required.
- Optional **thinking** (`reasoning_content`) surfaced in a collapsible block. On GLM-5.2+, **`reasoning_effort`** (`max`/`high`/`minimal`) tunes how hard it reasons (`minimal` skips thinking). Sent only when thinking is enabled, the effort isn't the default `max`, and the model is GLM-5.2+.
- **Sampling:** both `temperature` and `top_p` are exposed; GLM advises changing one, not both.
- **`max_tokens`** caps at 16384 in the UI (GLM-4.6 allows up to 128K); `0` omits it.
- **Preserved Thinking** (`thinking.clear_thinking:false`): with thinking on, prior assistant turns' `reasoning_content` is returned to the API verbatim so reasoning continuity carries across turns (better quality + cache hit rates). Costs more tokens per turn; default-on for the Coding Plan endpoint. Requires the exact original sequence, which we store untouched.
- Provider swap = change `base_url`/`model`/`api_key`; no logic changes (provider-agnostic).

---

## 9. Build, run, package

Prereqs: Node.js + npm on PATH.

```bash
# install deps (electron, electron-builder, openai, marked, pngjs, to-ico)
npm install

# run from source (dev)
npm start

# produce the Windows installer
npm run dist
```

Output: `dist\Constellation Setup 0.1.0.exe` (NSIS, non-one-click, per-user, lets the user pick the install folder) and `dist\win-unpacked\`.

**`package.json` → `build`** deliberately packages only:
```jsonc
"files": [ "main.js", "preload.js", "src/**", "config/modes/**", "build/icon.ico" ]
```
so the user's `settings.txt`, `project.txt`, and `data/` are **not** baked into the installer (the API key is never shipped). On first launch the installed app seeds fresh defaults into `%AppData%\constellation`.

The app icon (`build/icon.ico`) is set both as the `BrowserWindow` icon and the build icon.

---

## 10. Known gotchas

- **`var` not `const`** for the shared `Constellation` namespace, or a redeclaration SyntaxError silently kills a renderer module.
- **winCodeSign extraction** (`npm run dist` on a non-admin box): the `winCodeSign-2.6.0.7z` helper contains two macOS symlinks Windows can't create without Developer Mode/admin, so 7-Zip exits nonzero and electron-builder reports failure even though the win32 tools extracted fine. **Fix:** copy one of the partial temp extractions from `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<random>\` to `…\winCodeSign\winCodeSign-2.6.0\`; the build then finds it cached and skips. (Persistent.)
- **Rebuild file lock:** `npm run dist` can fail with `remove dist\win-unpacked\Constellation.exe: Access is denied` even with no app running (Explorer thumbnail handle or Defender scan). Transient. **Fix:** `rm -rf dist/win-unpacked` then re-run, or close any running Constellation + the open `dist` folder.
- **API-key endpoint:** Coding Plan keys need the coding endpoint (see §8); a 429 "余额不足" usually means the wrong endpoint, not insufficient credit.

---

## 11. Extension points

- **Add a provider:** point `base_url`/`model`/`api_key` at another OpenAI-compatible API. No code changes.
- **Add a mode:** drop a `config/modes/<name>.txt`; it's auto-loaded by `modes:load`.
- **Retune the look:** edit CSS variables in `src/styles/theme.css` (colors, fonts, `--chat-col`, `--font-scale`).
- **Regenerate the icon:** edit the tunable params at the top of `build/icon-render.js` and run `node build/icon-render.js`.

---

*End of spec.*
