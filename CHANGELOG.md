# Changelog

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
