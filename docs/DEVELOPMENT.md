# Development guide

How to work on ColiseumGrid. The design is in [`PLAN.md`](PLAN.md); the writing rules are in
[`DOC-STYLE.md`](DOC-STYLE.md).

M1 builds the workspace. Until then, the only code is the docs check.

## Requirements

- **Node 26.** The version is in `.nvmrc`. Node runs TypeScript directly (type stripping),
  so `core` and `server` have no build step.
- **pnpm 12.** From M1, the exact version is in `packageManager` in the root
  `package.json`.

### On the dev box

Development happens on Brad's Debian LXC container. For the tablets and a TV to reach a dev
server there, it listens on all addresses (Vite's `--host`), not only `localhost`.

## Commands

| Command | What it does |
|---|---|
| `node tools/check-docs.ts` | The writing-rules check (see "The docs check"). |

M1 adds `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm check` (all of them, in that order), and this table describes each.

## Layout

| Path | What it holds |
|---|---|
| `packages/core` | Rules shared by the browser and the server (see `PLAN.md` section 9). From M1. |
| `packages/server` | The Fastify server. From M1. |
| `packages/client` | The Host, Sign-up, and Display screens. From M1. |
| `tools/` | Scripts run by hand or in CI. |
| `docs/` | The docs listed in `DOC-STYLE.md`, "Where things go". |

## TypeScript

These carry over from Pattern Break:

- Relative imports carry the `.ts` extension: `import { x } from './x.ts'`.
- `erasableSyntaxOnly` is on, because Node can only strip types, not compile them: no
  `enum`, `namespace`, or constructor parameter properties. Use `as const` objects and union
  types.
- `strict`, `noUncheckedIndexedAccess`, and `noPropertyAccessFromIndexSignature` are on.
- `packages/core` gets ES2022 types only (no DOM, no Node), because it runs in the browser
  and on the server. Its tests type-check separately, with Node types.
- TypeScript 7 has no compiler API yet, so no tool in the repo may depend on one. That rules
  out typescript-eslint and ts-morph for now. Lint is Oxlint.

## Dependencies

Brad wants current libraries to avoid known vulnerabilities (2026-11-12).

- Exact versions in the lockfile. At the start of each milestone, update to the latest
  releases and recheck the versions in `PLAN.md` section 9, with the date.
- Dependabot opens updates for npm and GitHub Actions.
- CI runs `pnpm audit --audit-level high`. A high or critical advisory fails the build.
- When an update breaks something, fix the cause. Don't pin an old version to avoid it. (MEPN
  hit this with `passlib` and `bcrypt`: the fix was to drop the unmaintained `passlib`, not
  to hold `bcrypt` back.)
- A new dependency needs a reason: what it does that the platform or an existing dependency
  doesn't, and its last release date.

## Tests

- Vitest for `core` and `server`. Formats are tested with seeded randomness and fixed
  results, across every player count the roadmap names.
- Playwright for screens, printing, and the offline check. A PDF or print layout isn't
  verified until its pages have been rasterized and looked at (the MEPN lesson: an earlier
  check there confirmed only that a download fired, and two broken exports shipped).
- Check printing and the Display screen against a production build (`vite preview`), not
  only the dev server.

## The docs check

`tools/check-docs.ts` is Pattern Break's checker with this repo's lists. It reads every file
git tracks or would track, except the lockfile and binary files, and:

- fails on an em-dash or an emoji in any of them
- fails on a never-list word in Markdown prose (code spans and fenced blocks are skipped)
- lists check-every-time words without failing

`docs/DOC-STYLE.md` is exempt from the word checks, because it lists the words. Keep the
script's lists and the guide's "Plain wording" lists in step.

## Changelog and roadmap

`CHANGELOG.md` is the project's history, kept by whoever finishes the work. Its wording
needs no approval from Brad, as long as it follows `DOC-STYLE.md` (Brad, 2026-11-12).

- **A finished roadmap item leaves `ROADMAP.md`**, its "At a glance" row and its section
  together, and becomes an entry in `CHANGELOG.md`. A milestone is finished when the
  acceptance checks the agent can run pass. Hardware tests go in `PLAYTEST.md`; what they
  find becomes new roadmap items.
- **A new roadmap item** gets an "At a glance" row (one plain sentence and a stage) and,
  once planned, its own section with tasks, acceptance checks, and a **Docs:** line naming
  the files the work will change.
- **Changelog entries** are dated with the day the work lands on `main`, in
  America/New_York time (`TZ=America/New_York date`). If today already has an entry, add to
  it.
- **Item format:** `* **Label.** Sentence saying what changed and why it matters.` One goal
  is one item, however many commits it took. Don't log a defect that was introduced and
  fixed before anyone could hit it.
- **Sections:** **Milestones** until the first event; after that, **New Features**,
  **Improvements**, and **Bug Fixes**, in that order. A fix for something that should have
  worked goes under Bug Fixes.

## Git

- Commit and push before deploying anywhere. Deploys pull from git or the published image;
  nothing is copied to a server by hand.
- Run the checks before pushing (see `CLAUDE.md`, "Before you commit").
