<div align="center">
  <img src="docs/banner.svg" width="100%" alt="Constellation — your stories, written among the stars" />
</div>

<div align="center">

[![version](https://img.shields.io/badge/version-0.9.2-9fb8ff?style=flat-square)](https://github.com/Notsurejr/Constellation/releases)
[![platform](https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square)](https://github.com/Notsurejr/Constellation/releases)
[![license](https://img.shields.io/badge/license-MIT-4a7a4a?style=flat-square)](LICENSE)
[![engine](https://img.shields.io/badge/made%20with-Electron-9feaf9?style=flat-square)](https://www.electronjs.org/)

**A private, local-first writing companion for roleplay, fiction, and craft — set against a night sky that remembers your story.**

</div>

*Yes, it's all AI-generated code. I don't know how to code; I know what I wanted.*

---

Constellation is a desktop home for long-form AI-assisted writing. Bring your own key — GLM (Z.ai) out of the box, or any OpenAI-compatible provider (OpenRouter, Ollama, LM Studio…) — and get a calm, focused space built for *stories*, not chat transcripts: a lorebook that only sends the passages your scene needs, a Chronicle that keeps you from misremembering your own plot, sculpting and reasoning-steering for when the model's words aren't yours yet, and phrase bans that quietly scrub the AI-isms out of the prose. Everything — chats, lore, settings — lives in plain files on your machine.

> It's a *client*: Constellation has no AI of its own and no accounts. Your key talks straight to the endpoint you configure; your writing never touches anyone else's server.

---

## Why you might want it

**A Chronicle for the reader, not the model.** Fifty messages deep, *you're* the one who misremembers — who knew what, who's injured, what was promised. Open the Chronicle panel and distill your story into durable facts with one click. It reads in quiet chunks with a live progress bar, only processes what's new since the last pass, and every fact is editable and deletable. It's your reference; nothing from it is ever sent to the model.

**Your stories, written in the sky.** Every chat owns a constellation: one star for the story's first light, one more for every moment you bookmark. The current story's pattern hangs beside your prose — hover a star to glimpse its moment, click to travel back to it. The Sky map hangs all your stories in one sky together. And the sky *weathers* your story: tension red-shifts the stars and makes them flicker, sorrow dims and slows them, joy warms them gold.

**Worlds that stay consistent.** A lorebook holds your world bible — a whole 300 KB encyclopedia if you like — and only the passages relevant to the current scene reach the model. Entries fire on trigger words, or let smart retrieval find the right paragraph on its own. Enable a lorebook per chat, so your Warhammer campaign and your romance novella never contaminate each other. When lore feeds a reply, its star pattern lights up in the margin — click it to see exactly what the model was given.

**The model's words, made yours.** Sculpt edits a reply's prose in place, keeping the original beneath. The reasoning editor goes further: rewrite what the model "remembers having thought," and Preserved Thinking carries your version into every future send — a durable steer on how it approaches dialogue, pacing, and voice. An optional "lead its thinking" drawer authors the reasoning for the next send directly.

**Prose that reads like a page.** An immersion grammar teaches the model restrained typographic registers — split worlds, cinematic slugs, whispers, gated text — which the renderer shapes as the story asks. Pick your reading font (Literata, Newsreader, Lora, Atkinson Hyperlegible), set the line height, cap the line length to a bookish measure. When the story mentions colors, the words wear them.

**Take the best take.** Regenerate variants keeps every version of a reply — flip between them and continue from the one you like. Fork any message into a branching chat. Bookmark lines worth coming back to.

**Any provider, your key.** GLM's endpoints are built in (including Coding Plan keys), or point Constellation at OpenRouter, Ollama, LM Studio, or any OpenAI-compatible base URL with a custom model ID. Thinking effort carries over where the provider supports it.

**Private and portable.** No cloud, no accounts, no telemetry. Chats, lorebooks, chronicles, presets and journals are plain JSON/text in `%AppData%\constellation` — back up and restore the whole app to one file, or export every chat as readable Markdown. The renderer is sandboxed and every IPC surface is validated.

**And the practical bits.** Image input for vision models, collapsible preserved thinking, folders, pinned and hidden chats, full-text search, drafts, a writing coach with a craft journal, a context meter that shows exactly what was sent.

---

## Quick start

You need two things: the installer and an API key.

1. Download the latest **`Constellation Setup …exe`** from [Releases](https://github.com/Notsurejr/Constellation/releases) and run it. No Node.js, no command line — the runtime is bundled.
2. Launch Constellation, click the **✦ star** (top-left) → **System** tab → **Connection**.
3. Paste your **API key** and pick the matching **endpoint**:
   - **GLM — Coding plan (api.z.ai)** — for GLM Coding Plan keys (most common)
   - **GLM — General (api.z.ai / bigmodel.cn)** — standard GLM keys
   - **OpenRouter** — or **Custom** for any OpenAI-compatible provider (Ollama, LM Studio…)
4. **Save** — the status should read `connected`. Type something and press **Enter**.

> Wrong endpoint is the #1 cause of `429` errors. If you're on a Coding Plan key, use the Coding Plan endpoint.

### First things to try

- Ask for a vivid description of a sunset, then scroll through it slowly — watch the words color and the margins glow.
- Bookmark a line you love (★) — then look right: a star was just born in your story's constellation.
- Open the lorebook (❖) → create one called *My World* → paste your setting notes → tick it on for your chat.
- A few exchanges in, pull the **CHRONICLE** tab on the right edge → **Capture new**.
- Settings → Generation → Phrase bans → add `delve into = explore` and watch it vanish from replies.

---

## Feature tour

| | |
|---|---|
| **Chat** | Streamed markdown replies · expandable code blocks · edit & resend · stop mid-stream · continue after length-cuts · replies up to 64k tokens (log-scale control) |
| **The Cast** | Import character cards (chara_card_v2 — JanitorAI/Chub exports) · personas you play ({{user}}) · Start-chat compiles your instructions + the card + your persona into one editable prompt · embedded card lorebooks become Constellation lorebooks · chats badged with the character's face |
| **Thinking** | Collapsible reasoning blocks, saved with the chat · Preserved Thinking carries reasoning between turns · **reasoning editor** steers future replies · "lead its thinking" drawer seeds the next send |
| **Immersion grammar** | The model writes in restrained typographic registers — split worlds, pacing, whispers, alien speech, gated text — rendered as prose devices, not explained |
| **Chronicle** | Per-chat fact panel for the reader · chunked capture with live progress · incremental (reads only what's new) · Rebuild re-reads · editable facts · never injected into prompts |
| **Story Constellations** | Every chat is a constellation · stars = bookmarks · margin pattern with hover previews + jump · Sky map of all stories |
| **Lorebooks** | Titled collection · per-chat enable/disable · trigger-word entries · smart passage retrieval (BM25 + optional on-device semantic matching) · attach files to entries · the retrieval log shows exactly what was pulled |
| **Instructions** | Per-chat system + project prompts · presets · file attachments as context · attachment context controls (hide from the model without regenerating, or delete) |
| **Writing tools** | Sculpt mode · reasoning steering · phrase bans & substitutions · variant takes ‹ n/m › · forks with lineage links · bookmarks · craft coach + journal |
| **Media** | Image input for vision models (incl. glm-5.3-flash) · thumbnails in chat |
| **Exports** | Obsidian-friendly Markdown per chat (callout turns, folded thinking, sculpted marks) · Markdown backup: one dated .md per chat · JSON backup/restore for everything |
| **Reading** | Selectable fonts (Literata, Newsreader, Lora, Atkinson Hyperlegible) · line-height control · optional prose-measure cap (~75/90 characters per line) |
| **Connection** | GLM (Coding plan / General) · OpenRouter · any OpenAI-compatible base URL + custom model ID · thinking effort mapped per model |
| **Organize** | Folders · pinned chats · hidden chats · full-text search with jump-to-match · drafts per chat · lifetime token usage per chat |
| **The sky** | Color-word tints in prose (223 names) · margin glows + cosmic events (toggleable) · mood-weather starfield · parallax · twinkle & density controls |
| **For tinkerers** | Opt-in localhost CLI server + `cli.js` — offline data inspection *and* a prompt lab (`dry --probe … --system-file candidate.txt` iterates system prompts statelessly, thinking digest included) · theme/star colors in plain CSS |

**Keyboard:** `Enter` send · `Shift+Enter` newline · `Esc` close panel · `?` cheat sheet.

---

## Privacy & where your stuff lives

Constellation is a client around **your** key. Nothing is sent anywhere except your prompts to the endpoint you configure. The optional Chronicle capture sends your story text to *your* configured model for fact extraction — the results stay local, editable, and are never fed back into chats. The optional CLI server binds to localhost only, requires a per-launch token, and its commands are read-only apart from dry-sends (real model calls that persist nothing).

```
%AppData%\constellation\
├── config\    settings.txt, phrase_bans.txt, project.txt, modes\ (your prompts)
└── data\      sessions\ (chats), lorebooks.json, chronicle.json, presets\,
               bookmarks.json, craft_journal.txt, drafts.json, folders.json
```

Copy that folder to back up; delete it to fully reset. The in-app **Backup** button bundles everything into one JSON file. Semantic matching (optional, off by default) runs a local embedding model — your lore never leaves the machine for it.

---

## Developers — run from source

```powershell
git clone https://github.com/Notsurejr/Constellation.git
cd Constellation
npm install
npm start        # run from source
npm run dist     # build the Windows installer into dist\
```

Stack: Electron + vanilla JS (no build step), `marked` for markdown, `@huggingface/transformers` for optional on-device embeddings, bundled reading fonts (SIL OFL 1.1). See [`BUILD_SPEC.md`](./BUILD_SPEC.md) for the full architecture reference and [`CHANGELOG.md`](./CHANGELOG.md) for release history.

### Tweaking without code

| File | Controls |
|------|----------|
| `config\modes\*.txt` | The system prompt templates — rewrite freely |
| `src\styles\theme.css` | Colors, fonts, star color — the whole look (CSS variables) |
| `build\icon-render.js` | Params for regenerating the app icon |

---

## Troubleshooting

- **`429` / out of credits:** almost always the wrong endpoint — Coding Plan keys need the Coding Plan endpoint.
- **`401` / invalid key:** re-paste the key in Settings → Connection.
- **Reply not appearing:** check the status light (top-right; hover it for the last error) and the model/endpoint in Settings.
- **Custom provider not working:** double-check the base URL includes the version path (e.g. `/v1`) and that the model ID matches what the provider expects.
- **Old icon after rebuild:** Windows caches icons — reinstall or refresh the folder.

---

## Credits & licenses

Constellation is [MIT-licensed](LICENSE). It bundles MIT/Apache-2.0/BSD-licensed
libraries and the Google Literata, Newsreader, Lora, and Atkinson Hyperlegible
typefaces (SIL OFL 1.1) — full inventory in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
The optional semantic-matching feature downloads
[nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)
(Apache-2.0, © Nomic AI) at runtime; the model itself is not bundled.

---

<div align="center">

*Made with GLM. The sky is yours.*

</div>
