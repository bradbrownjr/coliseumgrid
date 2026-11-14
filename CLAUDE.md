# CLAUDE.md

A self-hosted tournament app for in-person video game events: kids sign up with a gamer
handle on a tablet, the host runs brackets and race heats from a laptop, and a TV shows who
plays next. It runs offline on a laptop or online from a Docker image. The docs, each with
one job:

- **`docs/PLAN.md`**: the design and the tech choices. Read the section for what you're
  changing before you start.
- **`docs/DESIGN.md`**: the UI rules. Read it before changing anything on a screen.
- **`docs/ROADMAP.md`**: what comes next, in order, with acceptance checks, and the open
  decisions.
- **`docs/CHANGELOG.md`**: what is finished.
- **`docs/DEVELOPMENT.md`**: setup, commands, layout, TypeScript conventions, dependencies,
  tests, and how the changelog and roadmap are kept.
- **`docs/PLAYTEST.md`**: the tests Brad runs by hand on real hardware.
- **`docs/DOC-STYLE.md`**: the writing rules.

These rules draw on Brad's other projects: ECTLogger (planning, engineering, and UI rules),
MEPN (security and verification lessons), and Pattern Break (doc layout, TypeScript
toolchain, the docs check, and the vulgarity filter).

## Writing

**Read `docs/DOC-STYLE.md` before writing anything a person reads:** docs, the README, code
comments, commit messages, UI text. In short: no em-dashes, no emoji, no filler phrasing,
sentence case, screen text a 12-year-old can follow, and verify every claim before writing
it. `node tools/check-docs.ts` fails on the parts a script can catch.

## Planning and working with Brad

- Answer a question before changing code. Treat every question as needing a direct answer.
- Before a feature or a significant change, present the plan, the open questions that affect
  it, and the risks. For a large change, agree on the plan before writing code.
- Open decisions are listed in `docs/ROADMAP.md`, "Open decisions". Ask Brad; don't guess.
- Never mark a milestone finished without reading its whole section, confirming every task
  and acceptance check is done, and checking with Brad. If in doubt, leave it in progress
  and say what's done and what isn't.

## Before you commit

Run `node tools/check-docs.ts`. From M1, run `pnpm check` (lint, type-check, tests, docs
check) and `pnpm build`. Fix every failure locally before pushing; don't push to see what CI
says.

Before each commit, look at `git diff --stat`. If a file shrinks by more than about 50
lines, confirm no finished feature is being removed. A commit that removes 200 or more lines
from one file says why in its message.

## Roadmap and changelog

- Work the roadmap in order. A milestone is finished when the acceptance checks the agent
  can run pass. Hardware tests go in `docs/PLAYTEST.md`; what they find becomes new roadmap
  items.
- A finished item leaves `docs/ROADMAP.md` (its "At a glance" row and its section together)
  and becomes an entry in `docs/CHANGELOG.md`. Format and dating rules are in
  `docs/DEVELOPMENT.md`, "Changelog and roadmap".
- A new roadmap item gets an "At a glance" row, and once planned, a section with tasks,
  acceptance checks, and a **Docs:** line.
- Technical facts and patterns that a future change needs go in `docs/DEVELOPMENT.md`.

## Hard rules

1. **Handles only.** Never store or show a player's name, email address, photo, birthday,
   or any other personal detail. A response that leaves the server lists its fields one by
   one; never return a database row as-is or widen a response with a catch-all.
2. **The server decides.** Every handle passes the `packages/core` filter on the server,
   whatever the client checked.
3. **Offline first.** No runtime request leaves the local network: no CDNs, web fonts,
   analytics, or update checks. Fonts, icons, and images are bundled. The one exception is
   Web Push, online over HTTPS only: the server sends an alert to the push service the
   player's browser chose (`PLAN.md`, "Player view"). Nothing else depends on it (Brad,
   2026-11-14).
4. **`packages/core` is portable.** No DOM, Node, or network imports. Randomness comes from
   a seeded source passed in by the caller, so every format is testable with fixed results.
5. **Every recorded result can be undone**, and undo restores the bracket or heat exactly.
6. **Online mode trusts nothing local.** With `COLISEUMGRID_MODE=online`, there is no
   `localhost` host sign-in. A client IP comes only from the last `X-Forwarded-For` entry, and
   only when the direct peer is the proxy; the first entry is set by the caller.
7. **Pairing codes** work once, expire after 10 minutes, and are rate limited.
8. **Current dependencies.** Latest releases at each milestone start, a lockfile, and
   `pnpm audit` failing CI on high or critical advisories. Never pin an old version to dodge
   a break; fix the cause.
9. **TypeScript 7 has no compiler API yet.** Don't add tools that need one
   (typescript-eslint, ts-morph). Lint is Oxlint.
10. **UI from MUI and the theme.** No hand-built controls where MUI has one, and no hex
    colors or pixel sizes outside the theme (see `docs/DESIGN.md`).

## Engineering

- **DRY, SOLID, KISS.** Match the patterns already in the code rather than inventing new
  ones for the same problem.
- **Root causes only.** When something breaks, find out why before changing anything. Don't
  patch the symptom, even when the right fix is larger.
- **Stay in scope.** Make only the changes asked for or clearly needed. No drive-by
  refactors, no helpers for one-time operations, no error handling for cases that can't
  happen. Validate at the system's edges.
- **Comments say why.** Explain business rules, state changes, and anything a reader would
  otherwise have to work out. Don't add comments, docstrings, or types to code you didn't
  change.
- **Verify by looking.** A screen, print layout, or PDF isn't verified until you've seen it
  rendered, against a production build as well as the dev server.

## Always and never

This file is the project's memory for agents. When Brad says to always or never do
something, add it here as a clear, testable rule with the date. A rule that isn't written
here may be forgotten next session.

- Rely on published knowledge, not assumed knowledge: before setting a design target, a
  standard, or a technical fact, find and cite a published source, and say so when none
  exists (Brad, 2026-11-11, from Pattern Break).
- A 12-year-old has to be able to host an event (Brad, 2026-11-12).
- Players are identified by a handle only. The optional PIN is 4 digits, suggested
  automatically so choosing one never holds up the sign-up line, changeable by the player,
  and printed small in a corner of the name tag (Brad, 2026-11-12).
- Vulgar handles are filtered the way Pattern Break filters names, tightened for handles:
  capital letters inside a handle count as word breaks (`BigAss` fails), and common
  spelled-by-sound variants are on the lists (Brad, 2026-11-12).
- Build on existing UI frameworks; this project uses MUI (Brad, 2026-11-12).
- It runs offline from a laptop (Windows or Fedora) and online from a Docker image (Brad,
  2026-11-12).
- A TV joins by typing an address and a 6-character code; the QR code is a shortcut for
  devices with a camera (Brad, 2026-11-12).
- Keep libraries current to avoid known vulnerabilities (Brad, 2026-11-12).
- The changelog's wording needs no approval from Brad, as long as it follows
  `docs/DOC-STYLE.md` (Brad, 2026-11-12).
- The license is MIT (Brad, 2026-11-12).
- Commit and push before deploying anywhere (from ECTLogger and MEPN).
- The main session is the project manager: it plans, splits the work, hands each task to a
  subagent on the latest Haiku, Sonnet, or Opus with an effort level fit for the task
  (Haiku for mechanical work, Sonnet for routine code and research, Opus for hard design or
  review), and checks what comes back before it lands (Brad, 2026-11-12).
- The colors are red and black, with light and dark modes. Primary is the same crimson in
  both modes; dark mode doesn't swap it for a lighter red (Brad, 2026-11-12).
- An entry panel, such as the PIN keypad, is centered on the screen (Brad, 2026-11-12).
- Places 1 to 3 are never shared, because prizes can't be split. A tie there is settled by a
  tie-break match or race among the tied players; other tied places are shared (Brad,
  2026-11-13).
- Late players never change a match already played or called (Brad, 2026-11-13).
- No game title or game company name in the repo: code, comments, tests, docs, or screen
  text. Write "fighting game" or "racing game" instead. The one exception is a citation: a
  source's own title and URL may name them. Setup templates are generic ("Fighting game",
  "Racing game"), and the host types the game's name for each event, which is stored as data,
  not code (Brad, 2026-11-14).
