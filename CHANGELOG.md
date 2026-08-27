# Changelog

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
