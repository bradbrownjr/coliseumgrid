# Development guide

How to work on ColiseumGrid. The design is in [`PLAN.md`](PLAN.md); the writing rules are in
[`DOC-STYLE.md`](DOC-STYLE.md).

M1 builds the workspace. So far it has `packages/core` (a seeded random source),
`packages/server` (the health route and the static file server), `packages/client` (the
theme and three placeholder screens), and the checks.

## Requirements

- **Node 26.** The version is in `.nvmrc`. Node runs TypeScript directly (type stripping),
  so `core` and `server` have no build step; only the client is built (by Vite).
- **pnpm 12.** The exact version is `packageManager` in the root `package.json`
  (`pnpm@12.18.0`).

### On the dev box

Development happens on Brad's Debian LXC container. For the tablets and a TV to reach a dev
server there, it listens on all addresses (Vite's `--host`), not only `localhost`.

## Commands

Run `pnpm install` once first.

| Command | What it does |
|---|---|
| `pnpm lint` | Oxlint over the whole repo. `packages/core/src` also bans `Math.random`, imports of Node built-ins (with or without `node:`), `ws`, and server packages, and DOM, Node, and network globals, read bare or through `globalThis`. A scratch import of a Node built-in also fails `typecheck`, because core has no Node types. |
| `pnpm typecheck` | `tsc` in every package, then `tools/`. `core` is checked twice: its source with ES2022 types only, its tests with Node types. `client` is checked twice too: the app with DOM types, `vite.config.ts` with Node types. |
| `pnpm test` | Vitest in every package (`vitest run`). In `core` it runs the `node` project only. |
| `pnpm test:browser` | The `core` `browser` project: the handle rules and the vulgarity filter in headless Chromium. Not part of `pnpm check`; CI runs it as its own job. Once per machine, run `pnpm --filter @coliseumgrid/core exec playwright install chromium`. |
| `pnpm check:docs` | The writing-rules check (see "The docs check"). Same as `node tools/check-docs.ts`. |
| `pnpm check:palette` | The palette contrast check. Imports `packages/client/src/theme/palette.ts`; exits non-zero on any failing row (see `DESIGN.md`, "Colors"). |
| `pnpm check` | `lint`, `typecheck`, `test`, `check:docs`, and `check:palette`, in that order, stopping at the first failure. Run it before every commit. |
| `pnpm build` | Runs each package's `build` script, if it has one. Only the client has one: `vite build` into `packages/client/dist`. |
| `pnpm dev` | Runs each package's `dev` script in parallel: the server with `node --watch` on port 3000, and the client's Vite dev server on port 5173, on all addresses. Open the Vite address; it forwards `/api` to the server on `localhost:3000`. |
| `pnpm start` | Starts the server once (`node src/main.ts`), serving the built client from `packages/client/dist`. Run `pnpm build` first. The app is then on port 3000. |

Also run `pnpm audit --audit-level high` before a milestone is done; CI fails on it.

### Server settings

The server reads these environment variables at startup (`packages/server/src/config.ts`).
A bad value stops it with a message.

| Variable | Default | What it does |
|---|---|---|
| `HOST` | `0.0.0.0` | The address to listen on. The default is every address, so tablets and a TV can reach it. |
| `PORT` | `3000` | The port to listen on, a whole number from 0 to 65535. |
| `COLISEUMGRID_MODE` | `offline` | `offline` or `online` (see `PLAN.md` section 8). Online turns on the rate limits on `POST /api/signup/claim`; later milestones add more. |
| `DATA_DIR` | `data` | The folder that holds the database file `coliseumgrid.db`. Absolute, or relative to the working directory (the server turns it into an absolute path at startup). The server creates it if it is missing. The Docker image sets `/data`. |
| `TRUSTED_PROXY` | none | The reverse proxy's IP address. Only a request whose direct peer is this address may name the client in `X-Forwarded-For`, and only the last entry is used (`CLAUDE.md`, rule 6). Without it, the client is the socket address. Set it online, behind the proxy; without it every player shares the proxy's address and its rate limit. |
| `CLIENT_DIST` | `packages/client/dist` | The folder of built client files to serve: absolute, or relative to the working directory. The default is found from the server package's location, so it works from any working directory. Read in `src/main.ts`, not by `loadConfig`. Without an `index.html` there, the server answers only `/api`. |

### Database

`packages/server/src/database.ts` opens the SQLite file with `node:sqlite` (`DatabaseSync`;
Node 26's docs name the class `Database` and call `DatabaseSync` a deprecated alias, but
`@types/node` 26.6.6 declares only `DatabaseSync`). The file is in WAL mode. The schema
version is `PRAGMA user_version`, and the schema is the ordered `MIGRATIONS` list: version N
means the first N entries have run, each once, in a transaction. To change the schema, add an
entry at the end; never edit one that has shipped. Tests use `':memory:'`. A database written
by a newer server is refused at startup.

## Layout

| Path | What it holds |
|---|---|
| `packages/core` | `@coliseumgrid/core`: rules shared by the browser and the server (see `PLAN.md` section 9). Today it holds the seeded random source. |
| `packages/server` | `@coliseumgrid/server`: `src/app.ts` builds the Fastify app (`buildApp`), `src/config.ts` reads the settings, `src/main.ts` starts it, `src/database.ts` holds the schema, `src/players-routes.ts` the players API, `src/pin-hash.ts` PIN hashing (scrypt), `src/client-ip.ts` and `src/rate-limit.ts` the online limits. |
| `packages/client` | `@coliseumgrid/client`: Vite, React, and MUI. `src/theme/` holds the palette and the theme, `src/pages/` the Host (`/host`), Sign-up (`/signup`), and Display (`/display`) screens, `src/components/` shared pieces, `test/` the Vitest tests. `/` goes to `/host`. |
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
- The palette lives in `packages/client/src/theme/palette.ts`, a plain `as const` object with
  no imports. The theme and `tools/check-palette.ts` both import it, so the two can't drift.
  Its tests check that every color has a `contrastText` and that the dark overrides use
  `primary.light`.
- `win`, `loss`, and `upNext` have one color each in the palette; the theme uses it for their
  `light` and `dark` slots too.
- Each override in `components.ts` is scoped with `theme.applyStyles('dark', ...)`, which
  produces `*:where(.mode-dark) &`. That also matches inside the TV route's `mode-dark`
  wrapper.
- Roboto comes from `@fontsource/roboto` (300, 400, 500, 700), imported in `main.tsx`. The
  `<weight>.css` files carry a `unicode-range` per subset; the `latin-<weight>.css` files
  don't, so don't import both kinds.
- The logo SVGs and favicons are imported through Vite from `assets/logo`, so the build
  bundles them. Nothing loads from a CDN (`CLAUDE.md`, rule 3). After `pnpm build`, `grep -rE
  'https?://' packages/client/dist` should find only XML namespace URLs (w3.org), the
  placeholder base `http://localhost` that React Router uses to parse paths, and text inside
  React, React Router, and MUI error messages; none of these is requested.
- The Display page never calls `setMode`, so it can't change the host's choice.

## Docker

The image is the online deployment (`PLAN.md` section 8): the server and the built client,
on Node 26 alpine, running as the non-root `node` user.

```sh
docker build -t coliseumgrid .
docker run --rm -p 3000:3000 -v coliseumgrid-data:/data coliseumgrid
```

The image sets `COLISEUMGRID_MODE=online`, `PORT=3000`, and
`CLIENT_DIST=/app/packages/client/dist`. It also sets `DATA_DIR=/data`, which holds the
database (and later uploaded graphics), so mount a volume there.

`.github/workflows/docker.yml` is the Docker check. It builds the image, runs it, waits for
`/api/health` to return `{"status":"ok"}`, and fetches `/` to confirm it is the client's
HTML. Only then, and only on the default branch, does it push
`ghcr.io/bradbrownjr/coliseumgrid:edge` and a `sha-` tag. Pull requests build and test
without pushing. The dev box has no Docker, so this CI job is the only place the image runs.

The Dockerfile installs pnpm with `npm install --global pnpm@<version>`, because Node 26 has
no corepack. Keep that version in step with `packageManager` in `package.json`.

## Tests

- Vitest for `core`, `server`, and `client`. Client tests need no DOM: they build the theme and
  call its overrides. Server tests build the app with `buildApp` and call
  `app.inject`, so they open no port. Formats are tested with seeded randomness and fixed
  results, across every player count the roadmap names.
- `core` has two Vitest projects (`packages/core/vitest.config.ts`): `node` runs every test, and
  `browser` runs `vulgarity.test.ts` and `handle.test.ts` in headless Chromium through
  `@vitest/browser-playwright`, so the filter is proven in the build the client ships.
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
