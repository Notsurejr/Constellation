# Constellation ✦

A cosmic desktop app for **roleplay**, **creative writing**, and **craft coaching** — powered by your own GLM (Zhipu AI / Z.ai) API key.

Constellation is a *client*: it has no AI of its own. It wraps your API key and steers, formats, and remembers your conversations with GLM. Your key and your chats stay on your computer.

> Pair this with [`BUILD_SPEC.md`](./BUILD_SPEC.md) for the full technical/architecture reference. This README is the plain-English user guide.

---

## 🚀 Install & run (the easy way)

You only need **two things**: the installer, and a GLM API key.

1. **Double-click `Constellation Setup 0.1.0.exe`** (in the `dist\` folder).
2. Pick an install folder (or accept the default) and let it install.
3. Launch **Constellation** from the Start Menu or desktop shortcut.

That's it for installation — **no Node.js, no command line, nothing else to install.** The whole runtime is bundled in the installer.

### First launch — add your API key
The app opens to an empty, starry chat. The first time:

1. Click the **✦ Constellation** star (top-left) to open **Settings**.
2. Under **Connection**, paste your **GLM API key**.
3. Pick the right **Endpoint**:
   - **Coding plan (api.z.ai)** — if your key is a *GLM Coding Plan* key (most common).
   - **General (api.z.ai)** or **General (bigmodel.cn)** — for standard keys.
4. Click **Save**. The status (top-right) should read `connected`.

You're ready. Type a message and press **Enter**.

> 💡 The app remembers your key and settings, so you only do this once.

---

## ✨ What you can do

**Chat**
- Streamed replies with live **markdown** formatting (bold, lists, code, tables, quotes, links).
- **Expandable code blocks** — wide code fences get an **Expand** button so they wrap to the window instead of forcing a left/right scrollbar.
- **Edit** any of your messages (✎) and resend, or **regenerate** GLM's reply (↻).
- **Stop** a reply mid-stream — the send button turns into a Stop button while generating, and whatever's already written is kept.
- **Continue** — if a reply is cut off by your max-length cap, a Continue button appears on it (and *only* then) to pick up where it stopped.
- **Copy** any message (⎘) or any code block.
- A collapsible **✦ Thinking** block when the model reasons before answering — **saved with the chat**, and when thinking is on the model **carries its reasoning between turns** (so it builds on, and corrects, earlier thinking instead of starting fresh).
- **Smart scroll**: if you scroll up to read while it's writing, it won't yank you back down. A **↓** button appears to jump to the latest.

**Files for context**
- Click **📎** (or drag files onto the chat) to attach `.md`/`.txt` files. Their text is read in and given to GLM as context — perfect for feeding it past markdown notes. Attachments stay with the message across saves/edits.

**Saved chats** (☰ sidebar)
- Chats auto-save. **New chat**, load, **rename** (✎), or delete (×). Rename once and it sticks (it won't revert to your first message).
- **Export** any chat to a Markdown/text file with the **⤓** button (top bar).
- **Pin** chats (☆) to keep the important ones at the top of the list.
- **Search** (🔍 in the sidebar) finds any phrase across all your chats; click a result to jump straight to it.
- **Fork** (⑂ on any message): branch a new chat off that point — the original stays intact. Forks are marked with a **↳ from** link back to their parent.
- Each chat shows its cumulative **token usage**; the sidebar footer totals it across all chats.

**Prompt presets**
- Save complete sets of system + project instructions and switch between them from Settings → Presets.

**Craft mode** (✒ top bar)
- A writing coach: pull your writing from the current chat (or paste text), get a streamed review, and any "Craft takeaway" gets logged to a growing **craft journal**.

**Appearance** (Settings → Appearance)
- **Text size**, **chat width**, **accent color**, **star density**, and **twinkle speed** sliders (live preview). The stars also **parallax** with your mouse for depth, and the app remembers its window size.

**Generation** (Settings → Generation · per-chat)
- **Model**, **Creativity** (0.01 steps), **Nucleus sampling**, **max reply length**, **Context window** (cap how much history is sent — 0 = all), **Thinking mode** + **effort**, and **Text flow speed**. These follow the chat; saving also sets the default for new chats.

**Quality-of-life**
- **Quick model switcher** — change the current chat's model from the dropdown in the top bar (no need to open Settings).
- **Draft autosave** — half-finished messages are saved per chat, so switching away and back never loses what you typed.
- **Zen mode** (☾ top bar, or Esc to exit): fades out the top bar and widens the conversation so you can focus — hover the top edge to bring the bar back.
- A **reading-progress** hairline on the right edge shows how far through a long chat you've scrolled.
- A **context meter** (◐ top-right) estimates how full the conversation is.
- **Backup / restore** (Settings → Data): save everything — chats, settings, prompts, craft journal — to one JSON file, or restore from one (overwrites current data).
- **Spellcheck**: right-click a misspelled word for corrections or "Add to dictionary."

**Keyboard**
- **Enter** = send · **Shift+Enter** = new line · **Esc** = close a panel / exit Zen · **?** = shortcuts cheat sheet.

---

## 💾 Where your stuff lives

Everything you create is stored in your user-data folder and **survives updates and reinstalls**:

```
%AppData%\constellation\
├── config\   settings.txt, project.txt, modes\ (your prompts)
└── data\     sessions\ (saved chats), presets\, craft_journal.txt
```

To back up Constellation, just copy that folder. To fully reset, delete it (the app recreates defaults on next launch).

---

## 🔁 Updating

Run the newer `Constellation Setup 0.1.0.exe` over your existing install. Your key, settings, and saved chats in `%AppData%\constellation` are untouched.

---

## 🛠️ Running from source / building (for developers)

If you want to modify the code or rebuild the installer:

1. Install **Node.js LTS** from <https://nodejs.org>.
2. Open a terminal in the `Constellation\` folder.
3. Install dependencies (once):
   ```powershell
   npm install
   ```
4. Run from source:
   ```powershell
   npm start
   ```
5. Build a fresh installer:
   ```powershell
   npm run dist
   ```
   Output lands in `dist\Constellation Setup 0.1.0.exe`.

---

## 🎨 Tweaking without code

| File | What it controls |
|------|------------------|
| `config\modes\roleplay.txt` (etc.) | The system prompt that steers each mode. Rewrite freely. |
| `config\settings.txt` | Key, model, endpoint, and all preferences (after install, this lives in `%AppData%\constellation\config\`). |
| `src\styles\theme.css` | Colors, fonts, star color — the whole look (CSS variables). |
| `build\icon-render.js` | Tunable params for regenerating the app icon (`node build\icon-render.js`). |

---

## 🆘 Troubleshooting

- **`429 余额不足` / "out of credits":** almost always the **wrong endpoint**. If you have a GLM Coding Plan key, choose the **Coding plan (api.z.ai)** endpoint in Settings. (If the endpoint is right, it genuinely means the account is out of credits/quota.)
- **`401` / "invalid key":** the API key was rejected — re-paste it in Settings → Connection.
- **Reply not appearing:** check the status (top-right) and the model/endpoint in Settings.
- **App icon looks old after a rebuild:** press `F5` in the folder, or reinstall — Windows caches icons aggressively.

---

*Made with GLM. The sky is yours.* ✦
