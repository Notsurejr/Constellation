# Changelog

## v0.9.3 — Field Report Release

*Released: 2026-10-02*

### New

- **Multi-turn prompt labs — dry --history-file** — a JSON array of messages replaces the
  conversation for that call, statelessly. Seeded-turn continuity without restarts or app
  patches; the history file is an owned input artifact, symmetrical with probes and candidates.
  (Designed from an agent lab operator’s field report after 21 rounds.)

### Fixed / improved (all from the same report)

- **Errors surface loudly** — a buried 429 inside an empty reply was a real misdiagnosis trap;
  dry now prints DRY FAILED and exits nonzero. Empty replies with no error get a budget hint.
- **state shows the full generation config** — temperature, samplers, max tokens, effort —
  closing the reproducibility gap for cross-round comparison.
- **Git-Bash paths work everywhere** — /c/... style paths in --probe/--system-file/
  --history-file/--out are normalized instead of resolving as C:c... .
- Reasoning-digest guidance baked into help: for steering work prefer --full (the signal is
  often mid-deliberation, which a digest cuts).

## v0.9.2 — The Prompt Lab

*Released: 2026-10-01*

### New

- **Stateless prompt testing** — /dry-send accepts a system override: the candidate system
  prompt rides the request itself, replacing the session’s for that one call. Nothing on disk
  changes. Iterating on instructions is now a single command per round.
- **cli.js grows a prompt-lab mode** — ping / state / dry with --probe, --system-file,
  --max-reason (head+tail thinking digest), --full, --json, and --out (writes the round’s raw
  JSON for the lab notebook). The offline inspectors (lorebooks/sessions/retrieve/bans/inspect)
  are unchanged. --profile aims the CLI at a sandbox instead of the live app.
- Verified live: a BANANA-seeded candidate provably reached the model statelessly.

## v0.9.1

*Released: 2026-10-01*

### Fixed

- **The “lead its thinking” drawer now actually hides** — a CSS `display: flex` rule on the drawer
  was overriding the hidden attribute, leaving it permanently visible from launch. It now opens
  on », hides on second click or Esc, and clears on send, as intended.

## v0.9.0 — The Thinking Hand

*Released: 2026-10-01*

### New

- **Edit the model’s reasoning** — every thinking block now carries a ✎ in its header. Edit
  what the model “remembers having thought”: the changed reasoning rides Preserved Thinking
  into every future send, durably steering how it approaches the next reply. The model’s own
  original words are kept beneath (·✎ marks the edit), for fidelity and for reverting.
- **“Lead its thinking” (» in the composer)** — a one-shot reasoning seed for the next send:
  the outgoing request ends with a partial assistant turn carrying your seed as in-progress
  thinking, visible in the ◐ inspector. Honest note: our testing shows GLM currently accepts
  but ignores reasoning seeds — kept deliberately as an experiment bench. The seed is stored
  with the reply’s reasoning, so even an ignored prefill steers future turns.
- **Exact token counts (where available)** — after each send, the app asks GLM’s tokenizer
  for the true context size; the ◐ meter switches from “~estimate” to the exact figure.
  Non-GLM providers, missing keys, and failures keep the estimate forever — never a dead end.
  (Coding-plan keys currently get 429 from the tokenizer — it’s billed under the general API —
  so estimates remain the norm until that changes.)

## v0.8.3 — Steady Hands

*Released: 2026-09-29*

### Fixed

- **No more flicker while drafting multi-line prompts** — typing on the second line of the
  prompt box no longer bumps the chat up and down. Root cause was twofold: a Chromium scroll
  adjustment that nudges the conversation up ~one line on every keystroke while it sits at the
  very bottom, and our correction landing a paint too late, so both positions flashed. The
  composer’s growth is now followed via a ResizeObserver (fires between layout and paint), and
  the native nudge is cancelled inside a requestAnimationFrame — nudges and corrections share
  a single frame, so only the settled position ever reaches the screen.

## v0.8.2 — The Eye Without the Resend

*Released: 2026-09-29*

### New

- **Hover eye on sent attachments** — every attachment chip in a sent message now reveals a
  small eye on hover: click to hide or unhide it from context in place. No edit mode, no
  resend, no regeneration — the conversation after that point stays exactly as it was.
  (Editing a prompt still resends and cuts below, as before, for when you want that.)

### Changed

- **Settings panel widened and retuned** — the tabbed panel breathes again (1060px), and the
  tab icons join the app’s glyph family: ✎ Writing · ✦ Generation · ◈ Appearance · ☰ System.

## v0.8.1 — Aligned With the API

*Released: 2026-09-29*

### Changed

- **Max reply length now defaults to 65,536** — the GLM-5.x provider default, per the docs.
  Previously the app shipped 4,096, which silently capped replies at a fraction of the
  model’s headroom. Existing saved settings are untouched.
- **Thinking effort matches the model** — GLM-5.3+ accepts only max / high / low, so Minimal
  hides for those models (Low joins the list) and any saved Minimal maps to Low when sent.
  GLM-5.2 keeps the full range. Confirmed in audit: stream is always true; do_sample is never
  sent and rides its default true.

## v0.8.0 — A Room to Read

*Released: 2026-09-29*

### New

- **Settings, in four tabs** — ✍ Writing · ⚙ Generation · 🎨 Appearance · 🗄 System. The same
  sections in the same order as always, each with its own home; the panel remembers your tab.
- **Reading fonts** — Literata (default), Newsreader, Lora, and Atkinson Hyperlegible, all
  bundled. Switch in Appearance; the prose changes, the UI stays itself.
- **Line height & prose measure** — set the leading you read best at, and optionally cap lines
  at ~75 or ~90 characters so prose holds a bookish measure no matter your window width.
- **Turn headers** — speakers now read as small-caps letterspaced headers (YOU / GLM) with a
  hairline running off to the edge — a cleaner manuscript rhythm than the old corner glyphs.

### Changed

- **Markdown that articulates** — bold, headings, lists, blockquotes, inline code, and links
  each carry their own structural styling (accent-barred quotes, chip code, accent markers),
  not just brightness.
- **The composer no longer swallows the reply's ending** — typing a long prompt keeps the
  last line of the model's response in view instead of covering it.
- Quieter lore constellations in the margins until they light; brighter hint/secondary text;
  the first message clears the topbar; dossier blocks get proper chrome.
- Zen mode removed — it didn't earn its button.

## v0.7.0 — The Cast

*Released: 2026-09-29*

### New

- **Cast panel (♛ in the topbar) — character cards & personas, separate from your chats.**
  Import chara_card_v2 JSON exports (JanitorAI / Chub / SillyTavern-adjacent); avatars are
  downloaded once and stored locally. The card's creator storefront, extension junk, and its
  own system directives are kept out of the prompt (noted on the card, never compiled).
- **Personas — the {{user}} side.** Any number of playables (name + description), one
  default, editable in the panel; substituted into cards at chat start.
- **Start chat screen.** Pick the greeting (Vanessa-grade cards bring 35+ alternates), the
  base instructions (your roleplay defaults / any preset / none — card only), and the persona —
  then review the fully compiled system prompt, editable line-by-line before the first send,
  with a live token estimate.
- **Seeded chats are ordinary chats.** The compiled prompt becomes that chat's system
  instructions; the greeting lands as the first reply. Everything you know — sculpt, Story
  Constellations, chronicle, mood-weather, the request inspector — just works. The card's
  embedded lorebook (character_book) is translated into a Constellation lorebook and attached.
- **Sidebar badges.** Character chats wear the character's avatar (or initial) on their
  session row, title tinted — distinct at a glance, same sidebar, same folders.

## v0.6.8 — Spent, Not Size

*Released: 2026-09-29*

### Changed

- **Sidebar token figures now read "spent"** — the per-chat and total numbers are lifetime
  usage (every send re-carries the full history, matching what the API bills), not current
  context size. Hover any figure for the explanation; the ◐ meter remains the live context size.

## v0.6.7 — Exact Values

*Released: 2026-09-29*

### Changed

- **Type exact values next to the Generation sliders** — Creativity, Nucleus sampling, Max
  reply length, and Context window each have a small number box beside the slider; drag or
  type, they stay in sync, and out-of-range entries clamp to the legal range on Enter.
- **Edit mode reads as a focused input, not an alarm** — the edit box now sits on a neutral
  border with your accent color arriving only as a focus glow; the Save/Cancel buttons no
  longer carry a hardcoded starlight tint that ignored custom accents.

## v0.6.6 — Bigger Touches

*Released: 2026-09-29*

### Changed

- **Attachment eye/× controls are ~25% larger** — easier to hit on image thumbnails.

## v0.6.5 — Quiet Fixes

*Released: 2026-09-29*

### Fixed

- **Scroll no longer bumps while you read** — model-side additions only auto-follow when you're
  already at the bottom; regenerating or continuing mid-read no longer yanks you down.
- **Forked chats keep their history intact** — sculpted replies now carry their ✎ state,
  preserved originals, and variants into the fork (previously silently dropped).

### Changed

- **Errors linger and explain themselves** — error toasts stay ~9 seconds with a highlighted
  border, and the status pill keeps the full message on hover after the toast fades. The
  provider's "unsafe/sensitive content" flag now explains the likely causes (old attachments
  riding in context) and what to do about it.
- **One settings table** — every settings.txt key is now defined in a single spec driving
  load, parse, and save (was three hand-maintained lists waiting to drift).

### Internal

- 63 silent `catch {}` blocks now log to the console (visible when debugging; invisible in
  normal use). The "newest-only attachments" rule is one shared function instead of two copies.

## v0.6.4 — Controls on the Chips

*Released: 2026-09-19*

### Changed

- **Attachment controls now overlay the attachment chips themselves** — when editing a
  prompt, the eye (hide from context) and × (delete) sit directly on each file/image
  thumbnail instead of in a separate list. Same behavior, more intuitive placement.

## v0.6.3 — Context You Control

*Released: 2026-09-19*

### New

- **Attachment context controls** — editing a user prompt now shows each attached file and
  image with two controls: an **eye** to hide it from context (it stays in the chat, dimmed
  and marked "not sent", but stops going to the model) and an **×** to delete it from the
  chat entirely. Exclusions persist and apply to every future call — the fastest way to
  isolate which attachment is tripping the provider's moderation.
- **Send attachments — newest only** — a Generation toggle. Off means older messages' files
  and images are kept out of the API call while the newest message's attachments still go
  through, so one old file can't block the whole conversation.

## v0.6.2 — Human-Readable Archives

*Released: 2026-09-19*

### New

- **Obsidian-style Markdown export** — the ⤓ export button now writes chats in a format
  built for Markdown readers: each turn is a callout (`[!QUESTION]` for you, `[!NOTE]` for
  the model — a clear divide between writer and AI), with YAML frontmatter carrying the
  title, model, and date. Sculpted replies are marked `✎ edited`.
- **Thinking blocks in exports — toggleable** — preserved thinking exports as *folded*
  callouts (collapsed until clicked). Toggle per-export in the ⤓ popover, or set the
  default in Settings → Data.
- **Markdown backup** — Settings → Data gains "Markdown backup…": every chat written as
  its own `.md` file into a folder you pick, dated and titled — chats stay separate,
  never mashed into one fat file. The JSON backup remains the full-fidelity restore path.

## v0.6.1 — Longer Skies

*Released: 2026-09-13*

### Changed

- **Max reply length: 16k → 64k, log-scale slider** — the old ceiling was ours, not the
  model's (GLM 5.x writes up to 128k). The slider now sweeps 512 → 65,536 tokens
  logarithmically, so the everyday low end stays just as easy to aim while chapter-scale
  replies and thinking-heavy generations get the room they need. Saved settings carry
  over unchanged.

## v0.6.0 — The Sky Remembers

*Released: 2026-08-27*

### New

- **Chronicle** — a reader's reference panel behind a slim tab on the right edge. It distills
  your story into durable facts (secrets, promises, injuries, turning points) so *you* never
  misremember your own tale. Capture reads only what's new since the last pass, in sequential
  chunks with a live progress bar; Rebuild re-reads the whole story. Facts are editable and
  deletable, stored per chat, and never injected into the model's context.
- **Story Constellations** — every chat owns a constellation: one star for the story's first
  light, one more for every bookmarked moment. The current chat's pattern hangs in the right
  margin (hover a star to preview its moment, click to travel there). Click it to open the
  **Sky map**, where all your stories are constellations in one sky.
- **Mood-weather sky** — the starfield reads the tone of your latest writing and eases toward
  it over ~15 seconds: tension red-shifts and quickens the stars, sorrow dims and slows them,
  joy warms, calm cools. Local word-list, no API calls; toggleable in Appearance.
- **Colored prose** — color words in the text now actually wear their color (they were tagged
  but never rendered before). The bank grew to 223 names, and dark hues (obsidian, onyx,
  graphite…) get a luminance floor so they stay readable on the black sky. Toggleable.
- **Any OpenAI-compatible provider** — OpenRouter, Ollama, LM Studio and friends via the
  endpoint dropdown + custom model IDs. Thinking effort maps to standard `reasoning_effort`
  on non-GLM providers.
- **New models** — glm-5.3-flash (fast, vision-native, generous coding-plan quota) in the
  picker; glm-5v-turbo and glm-4.6v for vision; retired dead glm-4v-flash.
- **Living Constellations** — lorebook entries that contributed to a reply light up as star
  patterns in the margins; clicking one shows exactly which passages the model was given.
- **Chat organization** — hide chats (⊘, revealed via a footer toggle), sidebar opens scrolled
  to the chat you're in, folders and pins as before.
- **Bundled Literata** — the app's typeface no longer depends on what's installed on a
  machine (SIL OFL 1.1, notice included).

### Fixed

- Bookmark jumps did nothing at all (a lost export) — they work again, landing on the saved
  message with a flash.
- Thinking blocks mysteriously shortened on some chats: per-chat settings snapshots had
  frozen a stale thinking-effort override. Snapshots now carry only the model; everything
  else follows global Settings.
- Cosmic events stopped spawning (margin zones measured from the wrong element) and could
  collide with the text column at wide chat widths — zones now derive from the real column
  edges.
- Freeze after failed/hung requests (infinite "thinking" loop); a 90-second watchdog now
  cancels silent hangs.
- Copy on long fresh replies came back blank; heavy paste sessions lagged the composer.
- Image thumbnails didn't render (CSP now allows data: URLs).
- GPU compositing crash ("the app splits in half") — effects no longer use backdrop filters,
  one nebula at a time.
- Scroll snap when a reply finished while you were reading above.

### Security & internals

- Hardened: sandboxed renderer, IPC id validation on every handler, navigation and
  window-open guards, strict CSP.
- Google Literata font files bundled under SIL OFL 1.1; third-party notices updated.
- Repo cleanup: stale dev data and build artifacts removed.

## v0.5.0 — Lorebooks, Bookmarks & the Color Atmosphere

*Released: 2026-08-14*

The big one: titled multi-lorebooks per chat with hybrid retrieval (keyword + optional local
semantic matching via nomic-embed-text-v1.5), bookmarks, regenerate variants, vision support,
phrase bans (applied after generation so the model never sees the list), the color atmosphere
with celestial events, a read-only CLI + localhost test server, and the v0.5.0 release with
README landing page and third-party notices.
