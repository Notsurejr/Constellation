<div align="center">
  <img src="docs/banner.svg" width="100%" alt="Constellation — your stories, written among the stars" />
</div>

<div align="center">

[![version](https://img.shields.io/badge/version-0.5.0-9fb8ff?style=flat-square)](https://github.com/Notsurejr/Constellation/releases)
[![platform](https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square)](https://github.com/Notsurejr/Constellation/releases)
[![license](https://img.shields.io/badge/license-MIT-4a7a4a?style=flat-square)](LICENSE)
[![engine](https://img.shields.io/badge/made%20with-Electron-9feaf9?style=flat-square)](https://www.electronjs.org/)

**A private, local-first writing companion for roleplay, fiction, and craft — set against a night sky that reacts to your story.**

</div>

*Yes this is all AI generated code, I don't know how to code. What do you want from me?*

---

Constellation is a desktop home for long-form AI-assisted writing. Bring your own GLM (Zhipu AI / Z.ai) API key and get a calm, focused space built for *stories*, not chat transcripts: per-chat instructions and models, a lorebook that only sends the passages your scene needs, variant takes you can flip between, and phrase bans that quietly scrub the AI-isms out of the prose. Everything — chats, lore, settings — lives in plain files on your machine.

> It's a *client*: Constellation has no AI of its own and no accounts. Your key talks straight to GLM; your writing never touches anyone else's server.

---

## ✦ Why you might want it

**🏰 Worlds that stay consistent.** A **lorebook** holds your world bible — a whole 300 KB encyclopedia if you like — and only the passages relevant to the current scene are sent to the model. Entries fire on trigger words, or let smart retrieval find the right paragraph on its own. Enable a lorebook *per chat*, so your Warhammer campaign and your romance novella never contaminate each other.

**📜 Instructions that follow the story.** Every chat carries its own system prompt, project notes, model, and generation settings — switch chats and everything switches with them. Save whole instruction sets as **presets** (Novelist, Editor, Brainstorm) and swap in one click. Attach `.md`/`.txt` files as living context.

**✍️ Prose without the tells.** A **phrase-ban list** quietly swaps or strips the words models overuse ("delve into", "a tapestry of") *after* generation — the model never sees the list, so it never leans into it. Your voice stays yours.

**🎚️ Take the best take.** **Regenerate variants** keeps every version of a reply — flip between them with ‹ 1/3 › and continue from the one you like. **Fork** any message into a branching chat. **Bookmark** lines worth coming back to.

**🌌 A sky that listens.** When a color word crosses the center of your screen, the background blooms with that color — and optional cosmic events (comets, planets, supernovas, flaring stars) fire in that hue. Reading a sunset becomes *seeing* one, a little.

**🔒 Private and portable.** No cloud, no accounts, no telemetry. Chats, lorebooks, presets and journals are plain JSON/text in `%AppData%\constellation` — back up and restore the whole app to one file.

**🖼️ And the practical bits.** Image input (vision models), collapsible preserved thinking, folders and pinned chats, full-text search, drafts, export to Markdown, a writing **coach** with a craft journal, zen mode, and a token meter.

---

## 🚀 Quick start

You need two things: the installer and a GLM API key.

1. Download **`Constellation Setup 0.5.0.exe`** from [Releases](https://github.com/Notsurejr/Constellation/releases) and run it. No Node.js, no command line — the runtime is bundled.
2. Launch Constellation, click the **✦ star** (top-left) → **Connection**.
3. Paste your **GLM API key** and pick the matching **endpoint**:
   - **Coding plan (api.z.ai)** — for *GLM Coding Plan* keys (most common)
   - **General (api.z.ai / bigmodel.cn)** — standard keys
4. **Save** — the status should read `connected`. Type something and press **Enter**.

> 💡 Wrong endpoint is the #1 cause of `429` errors. If you're on a Coding Plan key, use the Coding Plan endpoint.

### First things to try

- Open **❖ Lorebook** → create one called *My World* → paste your setting notes → tick it on for your chat.
- Settings → **Phrase bans** → add `delve into = explore` and watch it vanish from replies.
- Ask for a vivid description of a sunset, then scroll through it slowly. 🌌

---

## ✨ Feature tour

| | |
|---|---|
| **Chat** | Streamed markdown replies · expandable code blocks · edit & resend · stop mid-stream · continue after length-cuts · copy anything |
| **Thinking** | Collapsible reasoning blocks, saved with the chat; models carry reasoning between turns (Preserved Thinking) |
| **Lorebooks** | Titled collection · per-chat enable/disable · trigger-word entries · smart passage retrieval (BM25 + optional on-device semantic matching via nomic embeddings) · attach files to entries · 🌍 log shows exactly what was pulled |
| **Instructions** | Per-chat system + project prompts · presets · file attachments as context · first-run template files you can rewrite freely |
| **Writing tools** | Phrase bans & substitutions · variant takes ‹ n/m › · forks with lineage links · bookmarks (★) · craft coach + journal |
| **Media** | Image input for vision models · thumbnails in chat · export to Markdown |
| **Organize** | Folders · pinned chats · full-text search with jump-to-match · drafts per chat · usage/token tracking per chat |
| **The sky** | Color-word glow + cosmic events (toggleable, size/blend/reach controls) · parallax starfield · twinkle & density controls · zen mode |
| **Data** | One-file backup & restore · everything in plain files under `%AppData%\constellation` |
| **For tinkerers** | Opt-in localhost test server + read-only `cli.js` for headless poking · tweak theme/star colors in plain CSS |

**Keyboard:** `Enter` send · `Shift+Enter` newline · `Esc` close panel / exit Zen · `?` cheat sheet.

---

## 🔒 Privacy & where your stuff lives

Constellation is a client around **your** key. Nothing is sent anywhere except your prompts to the GLM endpoint you configure.

```
%AppData%\constellation\
├── config\    settings.txt, phrase_bans.txt, project.txt, modes\ (your prompts)
└── data\      sessions\ (chats), lorebooks.json, presets\, bookmarks.json,
               craft_journal.txt, drafts.json, folders.json
```

Copy that folder to back up; delete it to fully reset. The in-app **Backup** button bundles everything into one JSON file. Semantic matching (optional, off by default) runs a local embedding model — your lore never leaves the machine for it.

---

## 🛠️ Developers — run from source

```powershell
git clone https://github.com/Notsurejr/Constellation.git
cd Constellation
npm install
npm start        # run from source
npm run dist     # build the Windows installer into dist\
```

Stack: Electron + vanilla JS (no build step), `marked` for markdown, `@huggingface/transformers` for optional on-device embeddings. See [`BUILD_SPEC.md`](./BUILD_SPEC.md) for the full architecture reference.

### Tweaking without code

| File | Controls |
|------|----------|
| `config\modes\*.txt` | The system prompt templates — rewrite freely |
| `src\styles\theme.css` | Colors, fonts, star color — the whole look (CSS variables) |
| `build\icon-render.js` | Params for regenerating the app icon |

---

## 🗺️ Roadmap

- **Character & persona cards** — standalone cast sheets (SillyTavern-importable) that join a chat without cluttering the system prompt
- **A sky that reads the room** — mood tints and weather-reactive starfield driven by the model's own reading of the prose
- Folder-tied lorebook defaults · more sky events · pattern swatches

---

## 🆘 Troubleshooting

- **`429` / out of credits:** almost always the wrong endpoint — Coding Plan keys need the Coding Plan endpoint.
- **`401` / invalid key:** re-paste the key in Settings → Connection.
- **Reply not appearing:** check the status light (top-right) and the model/endpoint in Settings.
- **Old icon after rebuild:** Windows caches icons — reinstall or refresh the folder.

---

<div align="center">

*Made with GLM. The sky is yours.* ✦

</div>
