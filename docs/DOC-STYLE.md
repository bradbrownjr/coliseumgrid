# Writing and voice

Read this before writing or changing anything a person reads: the README, these docs,
`CLAUDE.md`, code comments, commit messages, and every string the app shows.

It is adapted from Pattern Break's `docs/DOC-STYLE.md`, which is adapted from ECTLogger's.
The parts a script can check are enforced by `node tools/check-docs.ts`, which runs in CI.

---

## 1. Voice

Write the way a developer writes to another developer, or a game host talks to players:
practical, specific, never breathless. It has to read like a person wrote it.

- **"You"** for the reader. "We" sparingly, for the project.
- **Sentence case** for headings, buttons, menu items, and labels. Proper names keep their
  real casing: ColiseumGrid, MUI, Fastify, Super Smash Bros., Mario Kart.
- **Contractions are normal, in moderation.** About one per seventy words. Writing them all
  out reads stiff; leaning on them reads chatty.
- **No em-dashes**, anywhere: docs, source, comments, commit messages, UI text. Reach for a
  colon, a semicolon, parentheses, or a full stop. A definition list is written
  `**Term**: definition`. `check-docs` fails on the character.
- **No emoji** in code, comments, commit messages, docs, or UI text. `check-docs` fails on
  them.
- **Give the why where it isn't obvious.** A rule whose purpose a reader can't guess gets
  one plain reason, once. A reason tacked onto every sentence is filler.
- **Expand a term on first use per document**, then use it freely.
- **Be honest about limits** where the reader will hit them, not in a footnote.

### Screen text is for a 12-year-old

The host may be 12, and the players are kids (Brad, 2026-11-12).

- Short labels and short sentences, in words a kid uses. Buttons are verbs: "Start", "Next
  match", "Print name tag".
- One idea per line. A screen that needs a paragraph to explain itself needs a simpler
  design.
- Never blame the reader. A refused handle reads "Pick another handle", not "Invalid input".

### Tournament words on screen

Some tournament words are jargon to a kid. On screen, use the plain version; the docs can use
either, once explained.

| Jargon | On screen |
|---|---|
| Bye | Moves on this round |
| Seed | Starting spot |
| Double elimination | Two lives |
| Round robin | Everyone plays everyone |
| Bracket reset | Rematch for the title |

### Plain wording

Say the fact once, in the plainest words that are true, and stop. Phrasing that reads as
machine written makes a reader stop trusting the rest of the page.

**Patterns to cut**, with the fix:

| Pattern | Before | After |
|---|---|---|
| Emphasis adverbs (genuinely, actually, really, truly, simply, quietly, honestly) | "the one truly fair format" | "the fairest format" |
| Reassurance and over-precision | "A code that only ever works once, guaranteed." | "A code works once." |
| A purpose clause on every sentence | "a queue, so you don't have to track who's next" | "The queue shows who's next." |
| Negative parallelism (not just X, X not Y, rather than) | "it tracks heats, not just brackets" | "it runs brackets and heats" |
| Inflated verbs for "is" or "has" (serves as, stands as, features, boasts, offers) | "The TV serves as the scoreboard" | "The TV is the scoreboard" |
| Trailing "-ing" commentary | "..., making it easy to see who's next" | (cut, or its own sentence with a fact in it) |
| Padding to three | "fast, simple, and fun" | the one that is true and checkable |
| Signposts (note that, keep in mind, it's worth noting, importantly) | "Note that results can be undone." | "Results can be undone." |
| Time filler (right now, currently, at this time) | "No match is running right now." | "No match is running." |
| Launch phrasing (from day one, out of the box, game-changing) | "PINs are supported from day one." | "Players can set a PIN." |

**Words that never appear** (`check-docs` fails on them): genuinely, honestly, truly,
delve, tapestry, testament, seamless, seamlessly, effortless, effortlessly, "it's worth
noting", "it's important to note", "rest assured", load-bearing, "from day one".

**Words to check every time** (`check-docs` lists them and does not fail): actually,
really, simply, just, quietly, instantly, right now, exactly one, not just, so you can, so
you don't have to, whether you're, one click, serves as, stands as, key, crucial, vital,
robust, leverage, enhance, unlock, showcase, underscore, highlight (as a verb), landscape
(as an abstract noun), foster, multifaceted, pivotal, vibrant. Keep one only when removing
it changes the meaning: "device key" stays; "simply tap Start" loses "simply".

One word proves nothing; people use all of these too. What gives text away is several of
them together, so read the paragraph, not the match.

Sources for the lists:

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
  WikiProject AI Cleanup's field guide.
- Kobak et al., [Delving into LLM-assisted writing in biomedical publications through excess vocabulary](https://arxiv.org/html/2406.07016v5).
- Juzek and Ward, [Why Does ChatGPT "Delve" So Much?](https://arxiv.org/abs/2412.11385).
- Liberman, [Are LLMs writing PubMed articles?](https://languagelog.ldc.upenn.edu/nll/?p=64877),
  on why a single word is weak evidence.

### Use the label that is on the screen

Where the code, the roadmap, and the screen disagree about what something is called, the
screen wins. A doc quotes on-screen text exactly, punctuation included, and mentions the
other name once so a search finds it.

---

## 2. Accuracy

- **Verify every factual claim before writing it**, against the code, the file, or the
  upstream source. If you can't confirm something, leave it out and say so.
- **A confident sentence in an existing document is not evidence.** Check the code, not the
  last document that mentioned it.
- **Describe what exists.** The README, the changelog, and anything a player or host reads
  never describe a feature that isn't built. Unbuilt work lives in `docs/ROADMAP.md` and
  `docs/PLAN.md`.
- **Versions carry a date.** When a document names a dependency version or a release, it
  says when that was checked.

---

## 3. Where things go

| File | Reader | What it holds |
|---|---|---|
| `README.md` | Someone who just found the repo | What it is, its status, the license, links to the rest |
| `docs/PLAN.md` | Anyone building the app | Design and tech choices |
| `docs/DESIGN.md` | Anyone changing a screen | UI rules |
| `docs/ROADMAP.md` | Anyone asking what's next | Unfinished work in order, open decisions |
| `docs/CHANGELOG.md` | Anyone asking what's done | Finished work, newest first |
| `docs/DEVELOPMENT.md` | Anyone changing the code | Setup, commands, layout, conventions, checks, process |
| `docs/PLAYTEST.md` | Brad | Tests that need a person or real hardware |
| `docs/DOC-STYLE.md` | Anyone writing | This file |
| `CLAUDE.md` | Coding agents | Working rules; points to the files above |

A topic gets one home. Other files link to it instead of repeating it.

---

## 4. Never do this

- Never use an em-dash or an emoji.
- Never ship filler phrasing (see "Plain wording").
- Never describe an unbuilt feature outside `docs/ROADMAP.md` and `docs/PLAN.md`.
- Never restyle quoted text.
- Never state a version without the date it was checked.
