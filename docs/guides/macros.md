# Macros — living values in the prompt

Macros are small placeholders that resolve at send time into real values: turn counters, dice, random picks, the clock. They make the prompt's bottom edge *move* — instructions that count the story, rolls that land where they're written, directions that rotate so the prompt never reads as a static block twice.

## Where macros work

**Macros are a cast-chat feature** — chats started from a character card. In regular chats nothing is substituted; the syntax passes through to the model verbatim.

The substitution points:

- **System prompt** (including compiled character blocks) — refreshes every send
- **The project fence** — refreshes every send
- **Message bodies** — freeze at first send: the resolved value is stored, so a rolled die never re-rolls and history stays honest

## The macros

| Macro | Resolves to |
|---|---|
| `{{turn}}` | How many user turns the chat has had so far — derived at send, so forks inherit the true count and old messages never lie about it |
| `{{roll:2d6}}` | A dice roll — `NdM`, summed. SillyTavern's `{{roll::2d6}}` double-colon form works too |
| `{{random:a, b, c}}` | One option, chosen fresh wherever it's refreshing. Options are comma-separated; `::` also works as a separator (handy when options contain commas) |
| `{{time}}` | The local clock at send |
| `{{date}}` | The local date at send |

## Freeze semantics (the part worth knowing)

- A macro fired in a **message body** no longer exists — the stored text holds its *value*. Editing that text later edits the value like any words; it never re-rolls.
- Typing a macro **fresh** in an edit-and-resend deliberately rolls a new value — a new freeze.
- **System and fence macros never freeze** — `{{turn}}` at turn 40 says 40, every send.

## The anti-rut trick

Because the project fence refreshes every send, `{{random:…}}` inside it shifts the prompt's texture each turn — the bottom of the wire never reads as the same static block twice:

```
Standing rules:
- Hold the scene's tension; let silence do some of the work.
- Direction for this beat: {{random:let a hesitation say more than a speech|let the other character scramble to save face|cut the scene one beat early|give the setting one live detail}}
```

Each send, one line of direction rotates. The model gets a fresh nudge exactly where attention is strongest, and the fence stops being furniture.

## Counting the story

`{{turn}}` makes time-aware instructions possible in the system prompt or fence:

```
- The ship's ration count: {{turn}} days out. Let supply pressure grow with it.
- At turn {{turn}}, consider whether the secret has held long enough to matter.
```

## Display quirks worth knowing

- In a regular chat, `{{...}}` renders on screen as a whisper-styled token with the braces eaten — but the text on the wire is verbatim; nothing was substituted.
- In a cast chat, pasted text containing `{{...}}` (changelogs, template snippets) WILL be substituted — macros don't know pasted prose from intention. Keep template syntax out of cast chats, or expect it to resolve once and freeze.
