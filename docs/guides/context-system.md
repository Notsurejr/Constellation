# Constellation — Context System Map

This document describes exactly what Constellation sends to a model, in order, so that a standalone chat can understand and craft content that works *with* the system rather than against it. Everything below describes the wire — the actual messages the API receives.

## The shape of the wire

Constellation sends ONE system message followed by a strict user/assistant alternation. Nothing else. All of the machinery below exists to fill that shape:

```
[1]  system      ← base instructions + world lore + files + grammar (the "top pile")
[2]  user        ← the conversation begins
[3]  assistant   ← (may carry reasoning_content — its preserved thinking)
[4]  user
[5]  assistant
[…]  …alternating…
[N]  user        ← the newest message, with depth injections riding near it
```

Depth semantics used throughout: **"depth N" means N messages counted from the bottom of the stack.** Depth 1 = the newest message; depth 2 = one before it. Depth 0 is not used for injections (the system message is index 0 and is never a target).

---

## Layer 1 — the system message (the top pile)

Assembled at boot of each turn, in this order:

1. **Base instructions** — the chat's system text. For cast chats this is the *compiled* prompt: chosen base (roleplay instructions / preset / card directives / none) + the character block (`## Character — name`, description, personality, scenario, example dialogue) + the persona block (`## You — persona`), baked at start-chat. For regular chats it is the roleplay-mode text.
2. **System files** — any `.md`/`.txt` files attached to the chat's system slot, inlined as `===== name (N chars) =====` blocks.
3. **Project files** — same, for the project slot.
4. **Immersion grammar** (optional toggle) — a prose-typography instruction block teaching the model optional inline marks (origin/world columns, compressed panic, whispers, redactions…). The model writes these marks; the renderer displays them.
5. **`# World` section** — the lorebook's contribution. Only *relevant* entries appear (see activation below), joined as plain text. Entries with a **depth** set skip this section entirely and ride inside the message stack instead.

The system pile is durable: it is identical every turn (plus or minus the `# World` section as relevance shifts).

---

## Layer 2 — the conversation

- **Strict user/assistant alternation.** Constellation never sends two user messages in a row; a system-role message appears only at index 0.
- **Preserved thinking.** With thinking enabled, prior assistant turns carry their `reasoning_content` (the model's own thinking, verbatim) — a **configurable depth**: all turns by default, or only the last N turns (a setting), with older turns sending clean prose. Recent planning stays; long chats don't drown the story in old reasoning.
- **Attachments.** With "send attachments" on, every user turn's files ride inline (`===== Attached file: name =====`); with it off, only the newest message's files are sent.
- **Message-body macros** (cast chats) are resolved once at send and the resolved value is stored — a rolled die never re-rolls.

---

## Layer 3 — the bottom injections (where attention is strongest)

Models grip instructions hardest near the end of the stack. Constellation places three kinds of content there, all at compose time and all never stored in the visible chat:

### 3a. Project instructions — `<project_instructions>`

The chat's project text rides the newest user turn (depth 0 — the prime slot), **prepended before the user's words** inside an XML-style fence:

```
<project_instructions>
…the project text…
</project_instructions>

…user's message…
```

The fence reads first (loads the instincts), the user's living beat lands last — the final tokens before generation are the story itself, not rules.

- The **tag is renameable per chat** (`standing_rules`, `mission_directives`…) so system instructions can reference the block by name.
- A **project depth** setting (0–12) raises the fence N messages from the bottom; the target snaps upward to the nearest user turn (fences only ride user turns).
- Exactly one copy per call. Never stored. Survives context trimming because the newest turn is always kept.

### 3b. Depth-injected lorebook entries — `<lore:Label>`

A lorebook entry with a **Depth** field (1–12) skips the system `# World` pile and lands inside the stack, N messages from the bottom — **prepended before that message's own text**, so the model reads Setting → Action → Reaction:

```
<lore:The Vault>
…the entry's content…
</lore:The Vault>

…that message's text…
```

This is for placing lore *near the action* — e.g. an entry relevant to the current scene injected a couple of messages up. Everything else (constants, keyword matches, scored passages) stays in the `# World` section.

### 3c. Card recall — `<lore:card recall>`

For cast chats with card re-injection enabled: once the conversation grows past a trigger size (estimated tokens), the compiled character + persona blocks re-enter the stack at a chosen depth, fenced as `<lore:card recall>`. The system-pile card stays full and untouched — this is a recall copy for adherence when the top of context has grown distant. Off by default; depth and trigger are per chat.

---

## What activates the `# World` lore

- **Constant entries** always appear.
- **Keyed entries** fire when a key appears in the recent window (per-entry scan depth, default 4 messages). Inline operators: `+key` must also match, `-key` suppresses when present. `[[Pickups]]` written inside lore prose register keys too — and are stripped to clean prose on the wire.
- **Keyless "smart" entries** (big documents) are scored per passage by keyword statistics + meaning-similarity; only the best passages come through, and a passage whose own `[[pickup]]` or section heading appears in the window fires deterministically.
- **Priority** (1–5) decides who survives when the character budget forces cuts.
- **Linger/cooldown** let an entry stay active N turns after a match, or rest N turns after firing.

---

## What never reaches the wire

- **Display filters** — regex rules that change what messages *look like* on screen only. The model always sees raw text.
- **Phrase bans** — applied to the model's output after generation, never shown to the model as a list.
- **Chronicle facts** — the reader-reference panel is for the human; it is never sent.

---

## Macros (cast chats)

In the system text, project fence, and message bodies: `{{turn}}` (user turns so far), `{{roll:NdM}}`, `{{random:a,b,c}}`, `{{time}}`, `{{date}}`.

- **System + fence macros refresh every send** — `{{turn}}` at turn 7 says 7.
- **Message-body macros freeze at first send** — the resolved value is stored, so history never re-rolls.
- Regular (non-cast) chats never substitute macros; the syntax passes through verbatim.

---

## Authoring guidance

- The **bottom is prime real estate.** Anything the model must obey *right now* belongs in the project fence (depth 0) or a depth-injected entry near the current exchange.
- The **system pile is for durable rules** — voice, style, world laws. It is read first and fades with distance in long chats; the card recall exists precisely because of this.
- **Fences are XML-style by convention** (`<tag>…</tag>`) and the model reads them as machine-framed spans. Reference them by name in instructions ("obey the standing_rules block").
- **Depth-injected content repeats every send** at its floor — keep it compact; it costs tokens every turn.
- The wire count is exact: the context meter's ◐ number mirrors what this document describes.
- **Anti-rut technique:** because the project fence refreshes every send, `{{random:…}}` inside it shifts its texture each turn — e.g. a `{{random:let a hesitation say more than a speech|let the NPC scramble to save face|cut the scene one beat early}}` line means the bottom of the wire never reads as the same static block twice.
