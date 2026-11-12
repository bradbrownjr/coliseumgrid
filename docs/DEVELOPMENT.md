# Development guide

How to work on ColiseumGrid. The design is in [`PLAN.md`](PLAN.md); the writing rules are in
[`DOC-STYLE.md`](DOC-STYLE.md).

M1 builds the workspace. So far it has `packages/core` (a seeded random source),
`packages/server` (the health route and the static file server), and the checks. The client
comes next.

## Requirements

- **Node 26.** The version is in `.nvmrc`. Node runs TypeScript directly (type stripping),
  so `core` and `server` have no build step.
- **pnpm 12.** The exact version is `packageManager` in the root `package.json`
  (`pnpm@12.18.0`).

### On the dev box

Development happens on Brad's Debian LXC container. For the tablets and a TV to reach a dev
server there, it listens on all addresses (Vite's `--host`), not only `localhost`.

## Commands

Run `pnpm install` once first.

| Command | What it does |
|---|---|
| `pnpm lint` | Oxlint over the whole repo. `packages/core/src` also bans `Math.random`, Node and server imports, and DOM, Node, and network globals. |
| `pnpm typecheck` | `tsc` in every package, then `tools/`. `core` is checked twice: its source with ES2022 types only, its tests with Node types. |
| `pnpm test` | Vitest in every package (`vitest run`). |
| `pnpm check:docs` | The writing-rules check (see "The docs check"). Same as `node tools/check-docs.ts`. |
| `pnpm check:palette` | The palette contrast check. Reads `tools/palette.json`; exits non-zero on any failing row (see `DESIGN.md`, "Colors"). |
| `pnpm check` | `lint`, `typecheck`, `test`, `check:docs`, and `check:palette`, in that order, stopping at the first failure. Run it before every commit. |
| `pnpm build` | Runs each package's `build` script, if it has one. Only the client will have one. |
| `pnpm dev` | Runs each package's `dev` script in parallel. Today that is the server with `node --watch`; the client adds its own. |
| `pnpm start` | Starts the server once (`node src/main.ts`), serving `packages/client/dist` when it exists. |

Also run `pnpm audit --audit-level high` before a milestone is done; CI fails on it.

### Server settings

The server reads these environment variables at startup (`packages/server/src/config.ts`).
A bad value stops it with a message.

| Variable | Default | What it does |
|---|---|---|
| `HOST` | `0.0.0.0` | The address to listen on. The default is every address, so tablets and a TV can reach it. |
| `PORT` | `3000` | The port to listen on, a whole number from 0 to 65535. |
| `COLISEUMGRID_MODE` | `offline` | `offline` or `online` (see `PLAN.md` section 8). Nothing reads it yet; later milestones use it. |

## Layout

| Path | What it holds |
|---|---|
| `packages/core` | `@coliseumgrid/core`: rules shared by the browser and the server (see `PLAN.md` section 9). Today it holds the seeded random source. |
| `packages/server` | `@coliseumgrid/server`: `src/app.ts` builds the Fastify app (`buildApp`), `src/config.ts` reads the settings, `src/main.ts` starts it. |
| `packages/client` | The Host, Sign-up, and Display screens. Not added yet. |
| `tools/` | Scripts run by hand or in CI, type-checked by `tools/tsconfig.json`. |
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

## Theme

MUI 9.5.0, checked 2026-11-12. The color values and rules are in
[`DESIGN.md`](DESIGN.md), "Colors".

- One theme holds both schemes: `createTheme({ colorSchemes: { light, dark }, cssVariables: {
  colorSchemeSelector: '.mode-%s' } })`. The default mode is the system setting. Switch with
  `useColorScheme()`; `mode` is `undefined` on the first render.
  (<https://mui.com/material-ui/customization/dark-mode/>)
- To force the TV route dark, wrap it in an element with the class `mode-dark`, which matches
  the selector `.mode-%s`.
  (<https://mui.com/material-ui/customization/css-theme-variables/configuration/>)
- Custom tokens (`win`, `loss`, `upNext`, `focusRing`) are added by module augmentation of
  `Palette` and `PaletteOptions`, plus `import type {} from
  '@mui/material/themeCssVarsAugmentation'`. A custom color needs `main`, `light`, `dark`,
  and `contrastText` set by hand. Components read them as `theme.vars.palette.x`.
  (<https://mui.com/material-ui/customization/palette/> and
  <https://mui.com/material-ui/customization/css-theme-variables/usage/>)
- MUI's default `contrastThreshold` is 3, so set `contrastText` explicitly for every color.
  (<https://mui.com/material-ui/customization/palette/>)
- In styles, use `theme.applyStyles('dark', ...)` instead of checking `palette.mode`.
  (<https://mui.com/material-ui/customization/dark-mode/>)
- From M1, the theme file in `packages/client` must take its values from `tools/palette.json`,
  or `check-palette` must read the theme, so the two can't drift.

## Tests

- Vitest for `core` and `server`. Server tests build the app with `buildApp` and call
  `app.inject`, so they open no port. Formats are tested with seeded randomness and fixed
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
