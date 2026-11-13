# Immersion Grammar — the typographic registers

The immersion grammar is a set of typographic marks the **model writes into its prose** and Constellation renders. It is how a reply shows a whisper, a redacted line, a montage cut, or a shot change — without the model ever explaining itself. This guide covers what each mark does, how to get the model to use them well, and where they stop.

## Turning it on

Settings → Writing → **Immersion grammar**. When on, Constellation teaches the marks to the model in the system prompt (with restraint rules baked in). The toggle only controls the teaching — the rendering is always live, so if you type the marks yourself they display too.

## The marks

### Line-level (whole lines, written before or around paragraphs)

| The model writes | The reader sees | Use it for |
|---|---|---|
| `<< line` | Flush left, italic | The origin/self world — memories, the past, montages of where you came from |
| `>> line` | Flush right, bold | The present/other world — contrasts against `<<`. The axis is *origin vs here*, not good vs bad |
| `@ line` (short) | A cinematic establisher | Time/place shot changes — `@ Night. The hold, three days out.` |
| `^ paragraph` | Opens with a drop cap | Scene and chapter openings only |
| `%% block %%` | Centered interlude | Verse, ritual, refrain, an inscription set apart |
| ``` ```file ``` fences | A dossier | Documents the character can read (part of the code-pane family) |

### Inline (inside sentences)

| The model writes | The reader sees | Use it for |
|---|---|---|
| `!!words!!` | Compressed panic | Peak stress; the mirror image of spacing — never both at once |
| `::w o r d s::` | Spaced letters | Dissociation, reality thinning |
| `{{word}}` | A quiet whisper | The barely-said |
| `~words~` | Stylized foreign | Speech the POV character does not truly understand — foreign, machine, dream |
| `==word==` | A marked word | The single word a scene turns on — at most once per scene |
| `\|\|text\|\|` | Gated content | The reader chooses to reveal (hover/click). Reserve for the worst moments |
| `[[message]]` | An on-screen text or written note | Something displayed in the scene |
| `[[>message]]` | A message the POV character sends | Their side of a written exchange |

### The restraint rules the model is taught

Plain prose is the default. At most one or two devices per scene, only when the moment earns it. Never stack everything. Never explain the marks. White space is a tempo instrument — collapse to short fragments at peak stress, open into long connected sentences at calm.

## Getting the most out of it

- **The model is taught automatically** when the toggle is on — you don't need to paste anything. To lean on a register at a specific moment, say it plainly in the project fence or your message: "the memory lands in the origin column", "that line is a whisper", "this exchange reads as a text thread".
- **A paste-ready reinforcement block** for a card or fence that keeps pulling the model toward purple marks:

```
Immersion grammar restraint: plain prose is the default. At most one or
two devices per scene. Never stack marks, never explain them. The marks
are typography, not content — if a scene needs explaining, write it
plainly instead.
```

- **Model-authored, not app-generated:** nothing is added that the model didn't write. If a reply has no marks, the model chose plain prose — which is usually correct.
- **The marks survive exports** as raw text; the rendering is a display layer.

## Where the grammar stops

- **Inside code panes**, the grammar does not apply — panes have their own quieter convention: `{{...}}` whispers, `[REDACTED]`-style brackets, `████` damage. See the [diegetic panes guide](diegetic-panes.md) for the boundary.
- Marks never render inside ordinary code fences.
- Display filters (Settings → Writing) shape the raw text *before* rendering, so a filter that rewrites text changes what the marks wrap.

## Pairing

The grammar pairs naturally with the **dialogue voices** (Settings → Appearance): voices style spoken dialogue, the grammar styles everything else. Both are model-authored, display-side, and cost no tokens beyond the marks themselves.
