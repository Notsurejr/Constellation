# Constellation — Build Specification

**Version:** 0.9.7 · **Platform:** Windows (Electron) · **Providers:** GLM (Z.ai / Zhipu) first-class, any OpenAI-compatible endpoint, Gemini via its compatibility layer

A desktop application that wraps a user-supplied LLM API key and *steers, renders, and remembers* the model for one reader:

1. **Roleplay & creative writing** — streamed chat sessions with visible, editable reasoning; immersion-grammar prose rendering; character cards and personas.
2. **A reading environment** — the chat is typeset like a manuscript on a living night sky.
3. **Craft mode** — a writing coach that reviews the user's own writing and accumulates lessons in a journal.

The app is a **client**, not a model: it holds no intelligence of its own. It packages, steers, and renders a model that runs on the provider's servers.

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Desktop runtime | **Electron 31** | Real installable app from web tech; full visual control; one language end-to-end. |
| Renderer | **Vanilla JS** (no framework, no build step) | Readable; zero compilation; easy for a non-programmer to follow. |
| LLM client | **`openai` SDK v4** (CommonJS) against any OpenAI-compatible endpoint | Standard, well-tested streaming; forwards provider-specific extras. |
| Markdown | **`marked`** (vendored UMD) + a DOM-tree sanitizer | Live formatting of model output. |
| Local embeddings | **`@huggingface/transformers`** (lazy) — `nomic-ai/nomic-embed-text-v1.5`, Matryoshka-truncated to 256 dims | Semantic lorebook retrieval with zero cloud calls. |
| Packaging | **electron-builder** (NSIS target) | Double-clickable Windows installer. |
| Persistence | Plain text + JSON in the OS user-data folder | Survives reinstalls/updates; editable by hand. |

Node/npm are required to develop and build; the shipped `.exe` has no runtime dependencies.

---

## 2. Architecture

A strict three-layer split. This is the most important idea in the codebase — it keeps the API key and all network access out of the untrusted UI.

```
┌──────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (main.js)            Node, full privileges      │
│  • holds the API key; all network calls                       │
│  • file I/O (config, sessions, lore, cards, exports, backups)│
│  • stream loop: GLM / Gemini / generic provider shaping      │
│  • CLI bridge server (localhost, opt-in), native dialogs     │
└───────────────▲──────────────────────────────┬───────────────┘
                │ IPC (ipcMain.handle)          │ contextBridge
┌───────────────┴──────────────────────────────▼───────────────┐
│  PRELOAD (preload.js)             contextIsolation: on        │
│  exposes a small, fixed window.api surface only               │
└───────────────▲──────────────────────────────────────────────┘
                │ window.api.*
┌───────────────┴──────────────────────────────────────────────┐
│  RENDERER (src/**)                untrusted, sandboxed UI     │
│  • never sees the key; asks main for anything privileged      │
│  • UMD modules on a shared namespace, no bundler              │
└──────────────────────────────────────────────────────────────┘
```

**Window settings:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, plus a strict Content-Security-Policy:
`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';`

Renderer modules attach to a shared global namespace:
```js
var Constellation = window.Constellation || (window.Constellation = {});
Constellation.chat = (function () { ... })();
```
> The alias **must use `var`, not `const`**. A second `const Constellation` throws "Identifier has already been declared" and silently kills that script (§10).

**Boot order** (`app.js`, on `DOMContentLoaded`): apply saved appearance → `settings.init()` → `sessions.init()` → `craft.init()` → `bookmarks.init()` → `lorebook.init()` → `cast.init()` (characters/personas) → `cliBridge.init()` → `chat.init()` → focus the input.

**Renderer modules** (`src/js/`): `app` (boot), `chat` (conversation, streaming, sculpt, attachments, reasoning), `settings`, `sessions` (sidebar), `craft`, `characters` (Cast panel + start-chat compile), `cardcompile` (pure card→prompt engine), `lorebook` (panel), `engines` (shared lore/ban engine: BM25 + cosine + budget), `md` (markdown + immersion grammar + sanitizer), `bookmarks` (Story Constellations), `constellations` + `story-sky` (sky map / mood weather), `chronicle`, `mood`, `sigils`, `colorfx` (color-word tinting), `starfield`, `cli-bridge` (lab relay).

---

## 3. Project structure

```
Constellation/
├── package.json              # metadata, scripts (start/dist), build config
├── main.js                   # Electron main: IPC surface, API calls, stream loop, CLI server
├── preload.js                # secure window.api bridge (~48 methods)
├── mdexport.js               # Obsidian-flavored Markdown export (main-process CommonJS)
├── mdexport-test.js          # unit tests for the above — `node mdexport-test.js`
├── cli.js                    # repo-root dev/lab tool: offline inspectors + prompt-lab commands
├── src/
│   ├── index.html            # the app screen + overlays (settings, craft, lorebook, cast…)
│   ├── lib/marked.umd.js     # vendored markdown parser (local <script>)
│   ├── fonts/                # bundled reading fonts (OFL): Literata, Newsreader, Lora, Atkinson
│   ├── styles/{theme,app}.css
│   └── js/                   # the 19 renderer modules listed in §2
├── config/                   # shipped defaults (modes + project text are packaged)
│   ├── modes/{roleplay,creative,craft}.txt
│   ├── project.txt
│   └── settings.example.txt  # reference copy only — never packaged, never read at runtime
├── data/                     # default data seeds (first run only, never overwritten)
└── dist/                     # build OUTPUT (disposable; regenerated by `npm run dist`)
```

---

## 4. Runtime data & configuration

All writable state lives in the OS user-data folder — **never inside the read-only packaged `app.asar`**. On Windows: `%AppData%\constellation\`.

```
%AppData%\constellation\
├── config\
│   ├── settings.txt          # key/value, table-driven (see below)
│   ├── project.txt           # per-project standing instructions
│   ├── modes\*.txt           # system prompts per mode (roleplay/creative/craft)
│   ├── personas.json         # Cast personas (name + description, one default)
│   └── phrase_bans.txt       # find = replace rules applied post-generation
├── data\
│   ├── sessions\*.json       # saved chats (the user's library — sacred)
│   ├── presets\*.json        # system+project prompt sets
│   ├── characters\*.json     # imported character cards (v2/v3, JSON or PNG-extracted)
│   ├── lorebooks.json        # lorebook collection { id: { name, semantic, entries[] } }
│   ├── bookmarks.json        # Story Constellations (bookmark stars)
│   ├── chronicle.json        # per-chat reader-reference facts
│   ├── folders.json          # sidebar folders
│   ├── craft_journal.txt     # accumulated craft takeaways
│   └── drafts.json           # per-chat composer drafts
├── window-state.json         # last window size
├── cli-server.json           # per-launch CLI bridge token (when cli_server on)
├── Custom Dictionary.txt     # Electron spellcheck additions (managed by Chromium)
└── transformers-cache\       # local embedding model (semantic lorebooks; ~130 MB, lazy)
```

On first launch, `copyTreeIfMissing()` seeds `config/` and `data/` from the shipped defaults. **Existing files are never overwritten** — which is also why updates never touch the user's library.

**Legacy migration:** a pre-collection `data/lorebook.json` (single book) is folded into `lorebooks.json` as "Main" once, only if the collection file does not yet exist. The original is left in place afterward and is never read again.

### Settings — the SETTINGS_SPEC table

`settings.txt` is parsed/written **table-driven** from `SETTINGS_SPEC` in main.js: one row per key, with a `kind` (`str`, `key`, `float`, `int`, `clampedInt`, `clampedFloat`, `onoff`, `enum`, `hex`) and default. The same table drives `config:load`, `config:save`, and the Settings UI wiring — **adding a setting is one row plus renderer plumbing.** Quirks preserved deliberately: a `0`, garbled, or absent value falls back to the row's default (so e.g. `chat_width: 0` → 880).

Current keys (0.9.7): connection (`api_key`, `model`, `base_url`), generation (`temperature`, `top_p`, `max_tokens`, `context_window`, `thinking`, `reasoning_effort`, `preserved_thinking`, `stream_cps`, `send_attachments`, `md_thinking`, `immersion`, `teach_edits`), appearance (`font_scale`, `font_family`, `line_height`, `prose_measure`, `chat_width`, `accent`, `star_density`, `twinkle_speed`, `color_words`, `mood_sky`, `fx_events`, `fx_size`, `flare_*`), system (`sidebar_sort`, `cli_server`, `last_backup`).

### Session format (`data/sessions/<id>.json`)

```json
{ "id": "s_...", "title": "...", "updatedAt": 0, "pinned"?: true, "parentId"?: "...",
  "folder"?: "...", "hidden"?: true, "lore"?: ["lb_..."], "character"?: { "id", "name" },
  "gen"?: { "model","temperature","topP","maxTokens","thinking","reasoningEffort",
             "streamCps","contextWindow","preservedThinking","sendAttachments" },
  "system"?: "...", "project"?: "...", "usage": { "tokens", "requests" },
  "messages": [ { "role": "user|assistant", "content": "...",
    "reasoning"?: "...", "rOrig"?: "...", "edited"?: true, "orig"?: "...",
    "variants"?: [...], "files"?: [ { "name", "size", "text", "excluded"? } ] } ] }
```

Each chat carries its own `gen`, `system`, `project`, lore attachments, and character link — restored on load. `reasoning` holds the model's thinking (GLM `reasoning_content` or Gemini thought summaries) so the ✦ Thinking block survives restarts and can be edited (with `rOrig` preserving the original). `usage.tokens` is a lifetime **spent** odometer (every request's full context + reply), distinct from the ◐ context meter's current-size reading.

---

## 5. The `window.api` surface (preload bridge)

Grouped; the renderer can call **only** these:

- **Config/modes:** `loadConfig` `saveConfig` `loadModes` `saveMode` `loadProject` `saveProject` `savePhraseBans`
- **Sessions:** `listSessions` `loadSession` `saveSession` `deleteSession` `renameSession` `setPinned` `setSessionHidden` `setSessionFolder` `setSessionLore` `searchSessions` `loadDrafts` `saveDraft`
- **Lore:** `loadLorebooks` `saveLorebooks` `embedTexts`
- **Cast:** `importCharacters` `importCharacterFiles` `listCharacters` `deleteCharacter` `loadPersonas` `savePersonas`
- **Reading layer:** `loadBookmarks` `addBookmark` `removeBookmark` `loadChronicle` `saveChronicle` `captureChronicle` `cancelChronicle` `onChronicleProgress` `loadFolders` `saveFolder` `deleteFolder` `toggleFolder`
- **Presets/craft:** `listPresets` `loadPreset` `savePreset` `deletePreset` `loadCraftJournal` `appendCraftJournal`
- **I/O:** `exportChatMarkdown` `tokenizerCount` `writeClipboard` `backupExport` `backupExportMarkdown` `backupRestore`
- **Streaming/CLI:** `chatStream(messages, opts, {onChunk,onDone,onError,onRetry,onThink})` `cancelStream` `onCliReq` `sendCliRes`

---

## 6. Streaming pipeline

**Main process** (`chat:stream` in main.js):

1. Builds an `openai` client from settings (`maxRetries: 0`); an `AbortController` is registered so the UI's Stop button can cancel.
2. **Provider shaping**, by endpoint:
   - **GLM** (`z.ai` / `bigmodel`): `thinking: { type:'enabled', clear_thinking: <preserved_thinking off?> }` and `reasoning_effort` mapped per family (5.3+ accepts only max/high/low; older enums mapped down).
   - **Gemini** (`googleapis.com`): thinking travels as `extra_body.google.thinking_config` — `include_thoughts` (from the thinking toggle) plus `thinking_level` mapped from the effort setting (max→high, medium→medium, low/minimal→low). **Mutually exclusive with `reasoning_effort`** — sending both is a 400.
   - **Other OpenAI-compatible:** the standard `reasoning_effort` knob, mapped. History is stripped of `reasoning_content` and of the prefill's trailing empty assistant turn (GLM-only constructs).
3. Retries the initial request up to **4 attempts** on transient errors (429/5xx/408/409/no-status; never on billing or 401), backoff `min(8000, 800·2^n)` ms.
4. Iterates the stream, forwarding chunks to the renderer:
   - `delta.reasoning_content` → `chat:chunk { kind:'think' }`
   - `delta.content` → `chat:chunk { kind:'text' }` — on Gemini, content first passes a stateful **`<thought>…</thought>` splitter** (marker holdback across chunk boundaries, end-of-stream flush) that routes summaries to the think channel so the reply stays clean prose.
   - the final chunk's `usage` and `finish_reason` are captured and forwarded in `chat:done`.

**Renderer** (`chat.js → streamReply`):

- Reveals text via a rAF typewriter pump at `streamCps` (`0` = instant); markdown re-parsed on a ~40 ms throttle.
- **Scroll etiquette:** model-side output never snaps a reader who's scrolled up (a ↓ jump button appears); the composer's growth is corrected pre-paint (ResizeObserver + rAF) so typing never flickers the chat.
- **Watchdog:** 420 s allowed before the *first* byte (compatibility-layer models think silently server-side), then 90 s between chunks once flowing — a silent hang cancels cleanly instead of locking the UI.
- On completion: phrase bans tidy the final reply, the mood sky assesses it, usage accrues, and the chat auto-saves (debounced). `finish_reason: 'length'` surfaces a **Continue** action.

---

## 7. Subsystems

### Markdown, sanitizer, and the immersion grammar
`marked.parse` → inert `<template>` → a DOM-tree-walker sanitizer (no scripts/iframes/`on*`/`javascript:` URLs). On top sits an opt-in **immersion grammar** (Settings → Generation, off by default): a system-prompt block teaches the *model* to author ~14 typographic techniques (flush-left/flush-right register columns, `!!panic!!` / `::d i s s o c i a t i o n::` letter distortion, `~alien speech~`, `%%centered verse%%`, `==marked==`, `||redaction||` with click/hover reveal, `[[message]]` chips, `@ slug` establishers, drop caps, dossier blocks); `md.js` renders them (`preGrammar` line pass before marked, `postGrammar` inline walk after). Distortion spans are atomic (`white-space: nowrap`). Two plumbing rules: GFM strikethrough would eat `~single-tilde~`, so alien speech rides through marked as private-use sentinel characters; raw-HTML emissions must be followed by a blank line or marked swallows the next markdown.

### Sculpt mode, reasoning steering, prefill
- **Sculpt (✎):** edit any assistant message; `orig`/`edited` preserve fidelity; optional "teach from edits" is off by default. Edit-and-resend truncates forward history; the hover eye on attachments hides from context *without* regenerating.
- **Reasoning editor:** every ✦ Thinking block has its own ✎ — editing writes `reasoning` while `rOrig` keeps the model's original. Via GLM Preserved Thinking, steered history becomes durable influence (the model cannot distinguish placed reasoning from its own).
- **Prefill drawer (»):** an optional reasoning seed for one send; rides as a trailing empty assistant turn after trimming; prepended to the stored reasoning so today's prefill steers tomorrow. (Tested verdict: GLM accepts but ignores seeds — kept as an experimenter's tool.)
- **Tokenizer:** `tokenizer:count` IPC asks the provider for exact counts on demand; coding-plan keys are declined (429), so the ◐ meter falls back to the `≈` chars/4 estimate.

### Lore engine (`engines.js`, shared)
Lorebooks are collections of entries with optional trigger `keys`. At send time: **constant** entries always inject; keyword entries match against the last 4 messages' full text; keyless entries are chunked and ranked by hybrid BM25 + cosine (local `nomic-embed-text-v1.5`, 256-dim, lazy-loaded) under a character budget. Attach/detach per chat via `setSessionLore`; cards seed their book as `lb_<cardid>`.

### Phrase bans
`config/phrase_bans.txt` — `find = replace` lines (empty replacement deletes), word-boundary, case-insensitive, applied to the final reply only. The model never sees the list.

### Story Constellations, Chronicle, mood, color
Bookmarks are stars (★ panel; the sky map overlay shows them as a navigable constellation). The Chronicle extracts per-chat reference facts (chunked, flash-extracted) into a reader's side panel. The mood sky weathers with the prose; color words wear their own hue (223-name bank).

### Sigils (✦)
A usage-ordered glyph picker beside the prompt box: ~640 glyphs across 7 groups, paginated, searchable, recents in renderer localStorage; inserts literal strings (quote pairs land caret-between).

### Settings UI
Four tabs (✎ Writing / ✦ Generation / ◈ Appearance / ☰ System), same sections in the same order within each; per-section scope-labeled saves; toggles autosave. Slider rows carry synced number boxes; the reply-length slider is log-scale 512→65,536.

### Sessions sidebar
Sorted by recency or pinned; folders, hide, rename, search (title + full-text with jump-to-match); fork (⑂) snapshots with lineage (`parentId` ↳ shown); per-chat **spent** token totals with a footer grand total.

### Exports & backups
- **Markdown export (⤓):** Obsidian-flavored — `[!QUESTION] User` / `[!NOTE] <Model>` callouts, folded thinking/system blocks, YAML frontmatter, `· ✎ edited` marks; thinking-block inclusion follows Settings. Built by `mdexport.js` (main-process; **must remain in `build.files`** or the packaged app crashes on require).
- **Per-chat Markdown backups** (Settings → Data): one dated `.md` per chat into a chosen folder.
- **JSON backup/restore:** full bundle (config + sessions + presets + drafts + journal) via native dialogs.

### Cast — characters & personas (♛)
Import chara_card_v2/v3 from JSON or **PNG** (the card rides tEXt/zTXt chunks; `ccv3` preferred over `chara`; zTXt is zlib-inflated). Re-importing the same name+creator **updates in place** (id preserved, so chat badges stay linked). Details show description/scenario/greeting previews. **Start chat** compiles once: greeting picker → base choice (**your instructions / a preset / the card's own directives / none**) → persona → an editable system-prompt preview with token estimate; the card's `system_prompt` becomes the base and its `post_history_instructions` land as a trailing Reminder block when "Card's directives" is chosen. The card's lorebook seeds the chat (decorator lines stripped). Personas are name+description presets, one default.

### CLI bridge & the prompt lab
An opt-in localhost server (Settings → System; port 7331; per-launch bearer token in `cli-server.json`; Host-header anti-rebind). Routes: `/ping` `/state` `/retrieve` `/bans` `/dry-send`. The repo-root `cli.js` wraps it for agents: offline inspectors (`lorebooks` `entries` `sessions` `retrieve` `bans` `inspect`) and lab commands (`ping` `state` `teardown` `dry` with `--probe` `--system-file` `--history-file` (self-chaining round files) `--effort` `--draws` `--max-reason` `--full` `--json` `--out`). **Not packaged** — a development-time tool.

---

## 8. Provider integration specifics

### GLM (Z.ai / Zhipu)
- Coding Plan keys require the **coding endpoint** `https://api.z.ai/api/coding/paas/v4`; the general endpoint returns `429 余额不足` for them.
- **Preserved Thinking:** with thinking on and `preserved_thinking` enabled (default), prior turns' `reasoning_content` is returned verbatim (`thinking: { type:'enabled', clear_thinking:false }`) — reasoning continuity across turns, better cache hits, more tokens.
- `reasoning_effort`: GLM-5.2 takes max/high/medium/low/minimal; **5.3+ accepts only max/high/low** (others map down).
- `max_tokens` defaults to 65,536 (the glm-5.x provider default); context caching is automatic.

### Gemini (compatibility layer)
- Base URL `https://generativelanguage.googleapis.com/v1beta/openai`.
- Thinking config travels as `extra_body.google.thinking_config` (`include_thoughts`, `thinking_level` low/medium/high) and **cannot coexist with `reasoning_effort`**.
- Thought summaries return **inside `delta.content`** as a `<thought>…</thought>` head block — the stream loop splits them into the think channel. Summaries can be legitimately empty on trivial prompts at low effort.

### Any other OpenAI-compatible provider
Change `base_url`/`model`/`api_key` in Settings → Connection. Reasoning fields and GLM-only constructs are stripped from history automatically; `reasoning_effort` is passed through with standard mapping.

---

## 9. Build, run, package

Prereqs: Node.js + npm on PATH.

```bash
npm install        # electron, electron-builder, openai, marked, @huggingface/transformers…
npm start          # run from source (dev)
npm run dist       # produce the Windows installer
node mdexport-test.js   # export unit tests
```

Output: `dist\Constellation Setup 0.9.7.exe` (NSIS, non-one-click, per-user) and `dist\win-unpacked\`.

**`package.json` → `build.files`** deliberately packages only:
```jsonc
[ "main.js", "preload.js", "mdexport.js", "src/**", "config/modes/**", "build/icon.ico" ]
```
so the user's settings, data, `cli.js` (dev tool), and `settings.example.txt` never ship — the API key is never packaged. First launch seeds fresh defaults into `%AppData%\constellation`.

---

## 10. Known gotchas

- **`var` not `const`** for the shared namespace — a redeclaration SyntaxError silently kills a renderer module.
- **`mdexport.js` must stay in `build.files`** — the packaged app requires it at runtime; omitting it ships an app that throws on first export.
- **winCodeSign extraction** (non-admin `npm run dist`): the helper archive contains macOS symlinks Windows can't create; if 7-Zip exits nonzero, copy a partial extraction from `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\` into place once and it stays cached.
- **Rebuild file lock:** `dist\win-unpacked\Constellation.exe: Access is denied` with nothing running — Explorer/Defender handle. `rm -rf dist/win-unpacked`, re-run.
- **SETTINGS_SPEC fallbacks:** `0`/garbage/absent → row default (by design; e.g. `twinkle_speed: 0` does not round-trip).
- **Immersion grammar plumbing:** single-tilde spans need the private-use sentinel smuggling; raw-HTML blocks need a trailing blank line.
- **Gemini:** `reasoning_effort` and `thinking_config` are mutually exclusive; expect long silent gaps before the first byte (the watchdog's 420 s first-byte allowance exists for this).
- **Dev sandboxes (file://):** a long-lived sandbox serves the renderer JS it loaded at launch — after editing renderer code, relaunch the sandbox before verifying.
- **Coding Plan endpoint:** a `429 余额不足` usually means the wrong endpoint, not insufficient credit.

---

## 11. Extension points

- **Add a provider:** point `base_url`/`model`/`api_key` at any OpenAI-compatible API. Provider-specific shaping branches live at the top of the `chat:stream` handler.
- **Add a setting:** one `SETTINGS_SPEC` row (kind + default) + renderer wiring; `config:load`/`save` follow automatically.
- **Add a mode:** drop `config/modes/<name>.txt` — auto-loaded by `modes:load`.
- **Add lorebooks/characters:** JSON on disk (formats in §4/§7) or the import dialogs.
- **Retune the look:** CSS variables in `src/styles/theme.css`.
- **Regenerate the icon:** edit tunables atop `build/icon-render.js`, run it.

---

*End of spec.*
