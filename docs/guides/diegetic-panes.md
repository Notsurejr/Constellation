# Constellation — Diegetic Panes: Prompting Guide

The renderer gives fenced text a life of its own: machine output sits in glass panes, signs and letters render as props of the story. This card tells you how to prompt a model so it reaches for the right fence at the right moment. Everything here is display-only — the model just writes ordinary fenced blocks; Constellation does the rest. Nothing extra is sent on the wire beyond the fence lines themselves.

## What the renderer does with each fence

| The model writes | The reader sees |
|---|---|
| ``` (plain fence) | A glass pane. If the content reads like a log — timestamps, dotted leaders (`key ..... value`) — keys, values and the title line get quiet tone automatically. Tagging the fence ```log, ```manifest, ```terminal, ```telemetry or ```console forces the same treatment. |
| ```ts / ```py / any language | Same pane, calm mono, the language as a whisper-quiet tag in the corner. No syntax coloring. |
| ```diff (or ```patch) | Changed-record styling the model already knows how to write: inserted lines pale green, deleted lines struck through in dim rose, `@@` hunk headers faint. Corrupted logs and edited drafts for free. |
| ```comms (or ```chat / ```sms / ```transcript / ```thread / ```hail) | A transcript: each line as `Name: message` (optional `[hh:mm]` timestamp) becomes a speaker tag in that name's own hue, message after it. Lines without a `Name:` prefix render as dim noise (stage business between lines). Never bubbles, never guessed alignment. |
| ```placard (or ```sign) | A diegetic placard: centered smallcaps **title**, a **subtitle** line, an ornament divider, then prose. For signs, notices, manifest plates, inscriptions — text that exists *in the scene*. |
| ```note (or ```letter) | A found note: italic serif on a ruled left edge; a final line opening with a dash becomes the signature. For letters, scrawled warnings, diary pages. |
| ```news (or ```clipping / ```article / ```broadsheet) | A broadsheet: line 1 = publication masthead (`THE CERES DISPATCH · 12 NOV 2186`), line 2 = the headline, then justified serif body under a double rule. For torn articles, newsfeeds, academic abstracts. |
| ```file | The dossier: joins the pane family (same glass, same text size) with its accent left rule and header-line tint. |
| any fence with long lines (72+ chars) | The pane widens toward the window's edges — charts and surveys get room. |

## Conventions the model must know

The styled fences read the fence's *shape* — plain text, no nested markup:

- **Placard:** line 1 = title (short). Line 2 = subtitle (short, no ending period) — optional. A line of only `---` or `· · ⋯` = divider (optional). Everything after = body prose.
- **Note:** paragraphs separated by blank lines. The **last** line, if it starts with `-` or `—`, renders as the signature.
- **News:** line 1 = publication and date. Line 2 = the headline. Everything after = body paragraphs.
- **Comms:** one exchange per line — `Name: message`, with an optional `[hh:mm]` leading timestamp. Blank lines separate exchanges; unprefixed lines become dim noise.
- **Diff:** the standard `+` / `-` / `@@` lines of a Git diff — no new convention at all.

If the model doesn't follow the convention the pane still renders — it just reads as flat prose instead of title-and-body. Basic ****bold**** and **emphasis** render inside prose panes, so model-habitual asterisks never show raw.

## Whispers and redactions inside panes

Inside any pane, the pane's own convention renders on its own, always on — independent of the response window's inline marks, and never as black censor bars:

- `{{a whispered aside}}` renders as quiet italic — the braces leave the screen.
- `[REDACTED]`, `[EXPUNGED]`, `[CLASSIFIED]`, `[WITHHELD]` render as dim spaced brackets.
- `[illegible]`, `[smudged]`, `[torn]`, `[water-damaged]`, `[burned]` and friends render as faded italic.
- Runs of `████` or `▓▓▓` render as faded ink — the characters stay visible, damaged rather than deleted.

Copy always keeps the exact original text, including the braces and brackets.

### How this relates to the immersion grammar

The response window and the panes use **two deliberate conventions** — this is the distinction, not an oversight:

- **In normal prose** (the response window), the full immersion grammar applies: `{{whisper}}`, `||redacted||` (black bars), `!!smash!!`, `::spaced::`, `~alien~`, `==marked==`, `[[messages]]`, and the line-level marks (`<< earth`, `>> ship`, `@ slug`, `%% centered %%`, `^ drop-cap`). All render regardless of the Settings toggle — the toggle only controls whether the model is *taught* the grammar.
- **Inside panes**, only the pane convention above applies. The rest of the grammar does nothing there: `||redacted||` written inside a fence shows its pipes literally (write `[REDACTED]` or `████` instead — no bars in panes), and `!!smash!!`, `~alien~` and friends stay literal too. Line-level marks don't apply inside fences at all.

So when prompting: grammar marks for narration in the response window; bracket-and-block patterns for damaged or whispered text inside panes. Don't mix them across the boundary.

**Three boundary notes:**
- `||redacted||` written inside a fence renders as the same quiet dim redaction (no pipes, no bars) — the grammar's habit-mark degrades gracefully instead of showing raw pipes. The other inline marks (`!!smash!!`, `~alien~`, `==marked==`) stay literal in panes.
- **Macro tokens are never styled:** `{{turn}}`, `{{roll:2d6}}`, `{{random:…}}`, `{{time}}`, `{{date}}` keep their braces everywhere — on screen and in panes — because they're syntax, not prose.
- **Tagged code fences are untouched:** in ```ts, ```py and friends, nothing is transformed, so a Vue/handlebars snippet displays truthfully. The pane conventions apply to plain, log-tagged, file, comms and prose panes.

### Teaching the model

Settings → Generation → **Diegetic panes** (on by default) teaches the model every convention on this page — the fence tags, their shapes, the damaged-text patterns, and the restraint rules — with the division of labor stated plainly: *inline marks shape sentences; panes are objects on the page.* Turn it off to save the tokens; the rendering works regardless.

## Paste-ready prompt block

Drop this into the chat's system prompt, the project fence, or a character card's directives — wherever instructions live for the chat in question:

````
In-scene text renders specially in this app. Use fenced blocks for text the
character can SEE or HOLD — never for narration:

- Screens, readouts, logs, transcripts: a plain fenced block. Use dotted
  leaders for readouts, like:
  hull ............ nominal
  Timestamps where a machine would log them: [04:19:02] relay :: message.
- Actual code: fence it with its language tag (```ts, ```py, …).
- Changed records, edited drafts, corrupted logs: fence as ```diff —
  standard +/- lines, nothing special to learn.
- Text threads, hails, intercom transcripts: fence as ```comms — one
  exchange per line as Name: message, optional [hh:mm] timestamps.
- Signs, notices, manifest plates, inscriptions IN THE SCENE: fence as
  ```placard — first line the title (short, uppercase works), second line
  the subtitle, then the body text.
- Letters, notes, scrawled warnings, diary pages: fence as ```note —
  body paragraphs, and the last line a signature starting with a dash
  (e.g. — M., third shift).
- Torn articles, newsfeeds, broadsheets: fence as ```news — first line
  the publication and date, second line the headline, then body text.
- Damaged text: write [REDACTED], [illegible] or ████ characters right
  in the fence text — they render as quiet censoring on their own.
- Whispered text inside fences: wrap it like {{this}} — quiet italics,
  no setting needed. (||word|| in a fence also renders, as the same
  quiet dim redaction — but || in normal prose is the gated-reveal
  mark, so prefer the bracket forms inside fences.)

Restraint: at most one or two such blocks per scene, and keep them short —
a pane is a prop, not a set piece. Never fence ordinary narration or
dialogue. If nothing in the scene is readable, use none of these.
````

(The fence names in the middle bullets are literal — the model writes ```placard, ```comms, ```diff and so on as the fence's opening tag.)

## Notes for the author

- **Costs almost nothing.** The pane styling is applied at render time; the wire only ever carries the fence and its text. A placard costs the same tokens as the same words in prose.
- **Any model can do it.** There is no special integration — if it can write a markdown fence, it can write these. Stronger models follow the shape conventions (title/subtitle/signature) more reliably; if one forgets, a one-line reminder in the project fence ("placards: title line, subtitle line, then body") is usually enough. ```diff needs no teaching at all.
- **Your side gets panes too.** Paste a log into your own message and it renders as one — the panes belong to the world, not to the model.
- **The tint is a heuristic, not a command.** A plain fence only tints when most of its lines look log-like; the explicit tags (```log and friends) force it. Tagged code never tints; prose panes never tint.
- **Pair with the display settings.** The panes and the response window live in Settings → Appearance; try Deep void + Recessed for a quiet instrument look, or Matches glass + Floating when the sky is doing things behind the page.
- **Test drive:** ask a model for "a deck log readout, a salvage placard bolted by a cargo door, a note left in a drawer, and the overnight text thread" — all four render styles in one reply.
