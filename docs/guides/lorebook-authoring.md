# Lorebook Authoring — world knowledge that activates by relevance

The lorebook is world context that reaches the model **only when it is relevant** — not a pile of text bolted onto every send. Entries watch the recent conversation for their keys; when a key appears, the entry rides along. This guide covers how to write entries that fire correctly, the tuning knobs, and the test-bench loop.

For the full picture of where lore lands on the wire (the `# World` section, depth injection, the bottom-of-context fence), see the [context system map](context-system.md).

## The basics

- **Books** hold entries; each chat enables whichever books it needs (the book picker in Settings → Writing, or the chat's lore controls).
- An **entry** has keys, content, and tuning knobs. When the entry fires, its content joins the `# World` section of the system prompt.
- **Constant entries** (the ✓ toggle) always fire, every send. Use for world laws that must never be absent — and keep them short, because they cost tokens every turn.

## Key syntax

The keys field reads one line of comma-separated patterns:

| You write | Meaning |
|---|---|
| `knight, paladin, Sir Gideon` | Fires when ANY of these appears in the scan window |
| `+castle` | MUST also match — the entry only fires if every `+` key is present too |
| `-dream` | Suppressor — the entry will NOT fire while this appears |

So `knight, +castle, -dream` means: fire on knight talk, only in a castle scene, never in dreams.

**Matching is word-boundary by default.** The key `war` fires on "a war rises" but NOT inside "warm", "award" or "warring" — and `*`` is a wildcard: `warp*` catches warping, warped, warpdrive. Keys that don't start or end with Latin word characters (CJK and other scripts) match by substring instead, where word boundaries don't exist.

**`[[Pickups]]` in the entry's prose are keys too.** Writing `[[the Hollow Bell]]` inside the entry's content registers "the Hollow Bell" as a key AND strips the brackets from the text the model receives — the prose reads clean while the phrase latches. This is how you make an entry self-perpetuating: its own text reintroduces the terms that recall it.

## Keyless "smart" entries

An entry with no keys is scored, not ignored: big documents are split into passages and each passage is ranked per send by keyword statistics plus meaning similarity (BM25 + embeddings). Only the best-scoring passages come through. A passage whose own `[[pickup]]` or section heading appears in the recent window fires deterministically — so you can bury a fact deep in a long document and still guarantee it surfaces when its phrase shows up.

Use smart entries for sourcebooks, long histories, laws — text too big to send whole. Use keyed entries for things that should appear *as a whole* when their trigger appears.

## The tuning knobs

| Knob | Range | What it does |
|---|---|---|
| **Priority** | 1–5 (3 = normal) | Who survives cuts. The whole lore contribution shares a character budget (Settings → Writing → **World budget**, default 8,000 chars, 2k–64k); when candidates exceed it, higher priority wins. Give 5 to world laws, 4 to major characters, 3 to everything else |
| **Depth** | 0–12 (0 = off) | 0 keeps the entry in the system-pile `# World` section. 1–12 instead injects it N messages from the bottom of the stack, **prepended before that message's own words** — scene-local lore placed next to the action it belongs to |
| **Scan msgs** | 1–16 (blank = 4) | How many recent messages this entry watches for its keys. Widen for slow-burn plot flags; narrow for high-traffic terms that would otherwise stay lit forever |
| **Linger** | 0–99 (blank = off) | Stay active N turns after the last match — for extended scenes where the topic dips out for a beat |
| **Cooldown** | 0–99 (blank = off) | Rest N turns after firing — for recurring characters you don't want re-explaining themselves every exchange |

## The test bench

Every entry has a bench: type a line as if the model (or you) had just written it, and see the verdicts live — **Fired** (made the wire), **Cut** (fired but lost the budget fight), **Suppressed** (a `-key` held it back). The loop:

1. Write the entry and its keys.
2. In the bench, paste a plausible recent exchange containing the key.
3. Check the buckets. If it's **Cut**, raise priority or trim the content. If it didn't fire at all, check spelling, the scan window, and any `-key` collisions.
4. Try the near-miss cases — the word that should NOT trigger it — to confirm the suppressors.

## Authoring advice

- **Write keys as they actually appear.** The scan is literal; if your prose says "the Hollow Bell" but the key is `Hollow Bell`, add both — or put `[[the Hollow Bell]]` in the content and let the pickup do it.
- **Trim the content, not the priority.** Entries compete on a budget; a 4,000-char priority-5 entry starves everything else. Priorities win the fight, but tight entries win the war.
- **Depth-injected entries repeat every send** at their floor while their keys keep matching — keep them compact.
- **Suppressors are cheap safety.** A `-key` costs nothing and prevents the most annoying failure mode: an entry that haunts every dream sequence because "shadow" is a key.
- **Importing from SillyTavern** maps over cleanly: entry comment → title, secondary keys → `+must` keys, priority → priority, `activate_after_match` style fields → linger.

## How lore looks on the wire

Every entry that makes the send rides in its own `<lore:Entry Title>` fence (the tag word is renameable — Settings → Writing → **Lore fence tag**), so the model can attribute each fact to its source. Depth-injected entries use the same shape inside the message stack.

### Cache-friendly lore placement

Settings → Writing → **Cache-friendly lore** (off by default) reshapes where lore lands for prompt-cache savings: **constant entries stay in the system prompt's `# World` section** (byte-stable), while **dynamic hits — keyword matches and smart-scored passages — ride the newest message**, above the project fence. The system pile and conversation history then stay byte-identical across turns, so the provider's prefix cache covers the whole conversation instead of being re-billed every time lore fires or expires. At 100k+ tokens that is the difference between full-price prefill and ~0.1–0.25× cached reads. Depth-assigned entries are explicit placement and never move. One caveat: `{{turn}}` in the *system prompt* still changes it every send — keep per-send macros in the project fence.

## What never reaches the model

Display filters (screen-only rewrites), phrase bans (applied after generation), and Chronicle facts (the reader-reference panel) are never sent. The lorebook is the only world-knowledge channel besides the system prompt itself.
