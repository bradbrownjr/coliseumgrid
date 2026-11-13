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
| `COLISEUMGRID_MODE` | `offline` | `offline` or `online` (see `PLAN.md` section 8). Online turns on the rate limits on `POST /api/signup/claim`, turns off the `localhost` host sign-in and the first-run password setup, and needs `COLISEUMGRID_HOST_PASSWORD`. |
| `COLISEUMGRID_HOST_PASSWORD` | none | The host password, 8 to 128 characters, taken as typed (spaces count). When set, it is the password and first-run setup is off. **Required online**: the server stops at startup without it. Offline without it, the first visit from the laptop itself (`localhost`) sets the password, once, and it is stored hashed (scrypt, like PINs). The server never prints or returns it. Changing it between starts ends every host session at startup (see "Host and device sessions"). The Unraid template has it as a masked variable. |
| `DATA_DIR` | `data` | The folder that holds the database file `coliseumgrid.db`. Absolute, or relative to the working directory (the server turns it into an absolute path at startup). The server creates it if it is missing. The Docker image sets `/data`. |
| `TRUSTED_PROXY` | none | The reverse proxy's IP address. Only a request whose direct peer is this address may name the client in `X-Forwarded-For`, and only the last entry is used (`CLAUDE.md`, rule 6). Without it, the client is the socket address. Set it online, behind the proxy; without it every player shares the proxy's address and its rate limit, and the server prints a warning at startup. |
| `CLIENT_DIST` | `packages/client/dist` | The folder of built client files to serve: absolute, or relative to the working directory. The default is found from the server package's location, so it works from any working directory. Read in `src/main.ts`, not by `loadConfig`. Without an `index.html` there, the server answers only `/api`. |

### Host and device sessions

`packages/server/src/access.ts` decides who a request is; the contract is `PLAN.md` section 3,
"Devices and host API".

- **Tokens.** A host session (`cg_host`) and a paired device (`cg_device`) each hold 32 random
  bytes from `node:crypto`, sent once in a cookie and stored only as a SHA-256 hash
  (`tokens.ts`). A random 256-bit token can't be guessed at any speed, so it needs no slow
  hash; the hash only keeps a copied database from signing anyone in. Passwords use scrypt
  (`pin-hash.ts`). The cost is the PIN's, so raise it there if the host password ever matters
  more than a PIN.
- **Cookies.** `cookies.ts` reads and writes them by hand (no cookie package): `Path=/`,
  `HttpOnly`, `SameSite=Strict`, and `Secure` only when the request came over HTTPS. The
  server speaks plain HTTP, so HTTPS is known only from the reverse proxy: the last
  `X-Forwarded-Proto` entry, and only when the direct peer is `TRUSTED_PROXY` (`CLAUDE.md`,
  rule 6). A host session lasts 12 hours from sign-in and is never extended. A device cookie
  lasts 400 days, the most Chrome keeps
  (<https://developer.chrome.com/blog/cookie-max-age-expires>); the server expires a device
  only when the host unpairs it.
- **The laptop counts as the host** (offline only) when the socket's peer is `127.0.0.1`,
  `::1`, or `::ffff:127.0.0.1`. Online it never does. Headers can only take this away: a
  forwarding header, a `Host` that isn't `localhost`, `127.0.0.1`, or `[::1]` (DNS
  rebinding, or a dev proxy such as Vite passing a LAN request through), or an `Origin` that
  doesn't match `Host` (another site's script) all make the request an ordinary one that
  needs the password. Don't put an offline server behind a reverse proxy on the same machine.
- **Which route needs what.** Host routes need a host session (401 `not-signed-in`), sign-up
  routes a Sign-up device or a host session, `GET /api/event` and `GET /api/live` any host or
  device. The check runs as an `onRequest` hook, before the body is read. A Display is
  refused the sign-up routes with the same 401.
- **Guessing limits.** Wrong host passwords and wrong pairing codes are limited per client IP
  in both modes (`rate-limit.ts`: 10 wrong tries per 10 minutes each, counted before the slow
  check). Wrong pairing codes are also capped across all callers, 100 per 10 minutes, because
  the per-IP limit means little against a caller with many addresses; the arithmetic is on
  `JOIN_MAX_WRONG_GLOBAL`. Every per-client key comes from `getClientKey` in `client-ip.ts`,
  which counts an IPv6 address by its /64 (IPv4 and IPv4-mapped IPv6 stay per address). A
  `FailureLimiter` holds at most 10,000 keys and answers as blocked for a new key when full,
  so a flood of made-up keys can't grow it without bound. The tests move time with the `now`
  option of `buildApp`.
- **Origin check.** `app.ts` has an `onRequest` hook that answers 403 `forbidden` to any
  request other than `GET`, `HEAD`, or `OPTIONS` whose `Origin` host and port differ from its
  `Host`; `GET /api/live` runs the same check (`rejectForeignOrigin` in `access.ts`). The rule
  and the reason are in `PLAN.md` section 3. It depends on the original `Host` reaching the
  server, so a reverse proxy must not rewrite it (see "Docker").
- **Repeated cookies.** `parseCookies` returns every value of a name. A page on a sibling
  subdomain can set a second `cg_host` or `cg_device` with a narrower path, which browsers
  send first, so `access.ts` takes the first value that is a real session or device.
- **Live updates.** `GET /api/live` is a WebSocket (`@fastify/websocket`). `live.ts` keeps the
  open connections, pings them every 30 seconds, drops the ones that don't answer or whose
  sign-in ended, and sends `unpaired` before closing a device the host removed. Routes
  announce changes with `hub.broadcast`. Tests connect with the plugin's `app.injectWS`, which
  runs the real upgrade path over in-memory streams: call `await app.ready()` first, give it
  the peer address as `{ socket: { remoteAddress } }`, and close each socket at the end.
- **The current event** is the newest row of `events`. `PUT /api/event` renames it, or makes
  the first one. Names are 1 to 60 characters with spaces tidied.

### Client screens and the API

How the client talks to the server (`packages/client/src`).

- **Calls.** Every call goes through `api/request.ts`: it resolves to a `Result` (`ok` and `data`, or
  `ok: false` and an error code), never throws, sends cookies (`credentials: 'same-origin'`), and
  reads a 204 as `ok` with no data. `api/players.ts` and `api/host.ts` are one line per route. A
  401 `not-signed-in` on any call also runs the listeners from `onNotSignedIn`: the host page
  returns to its sign-in panel, and a paired screen returns to the join screen.
- **Who sees a screen.** `/host` asks `GET /api/host/session` first (`pages/HostPage.tsx`). `/signup`
  and `/display` sit inside `components/AccessGate.tsx`, which sends anyone without a device of
  the right role (or, for Sign-up, a host session) to `/`. `/` is the join screen
  (`pages/JoinPage.tsx`): a paired device goes on to its own screen, and `?code=` joins at once and
  is removed from the address.
- **The live connection.** `components/useLive.ts` opens `GET /api/live` (ws or wss to match the
  page) and reconnects after a drop with a wait that doubles from 1 to 30 seconds with jitter
  (`api/live.ts`). It stops on `unpaired` and when the sign-in has ended. `onOpen` runs on every
  connect, so a screen reloads what it shows; messages sent while it was down are lost. In
  `pnpm dev`, the Vite proxy needs `ws: true` for `/api`, which `vite.config.ts` sets.
- **The join address.** The pairing panel builds it from `window.location.origin`. On `localhost`
  no other screen can reach that, so the panel asks the host to type the laptop's network
  address; the server doesn't report one.
- **QR codes.** `lean-qr` makes one SVG path (`pairing.ts`, `pages/host/JoinQr.tsx`). The code is
  always dark on light, in both color modes.
- **Screens in tests.** Client tests need no DOM, so the pure parts are in `api/live.ts` and
  `pairing.ts`. Screens are checked with Playwright against `packages/client/dist`, with `/api`
  answered by `page.route` and the socket by `page.routeWebSocket`.

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
| `packages/server` | `@coliseumgrid/server`: `src/app.ts` builds the Fastify app (`buildApp`), `src/config.ts` reads the settings, `src/main.ts` starts it, `src/database.ts` holds the schema, `src/players-routes.ts` the players API, `src/pin-hash.ts` PIN and password hashing (scrypt), `src/client-ip.ts` and `src/rate-limit.ts` the client address and the guessing limits, `src/access.ts`, `src/host-routes.ts`, `src/devices.ts`, `src/host-store.ts`, `src/events.ts`, and `src/live.ts` host sign-in, pairing, and live updates. |
| `packages/client` | `@coliseumgrid/client`: Vite, React, and MUI. `src/theme/` holds the palette and the theme, `src/pages/` the Host (`/host`), Sign-up (`/signup`), and Display (`/display`) screens, `src/components/` shared pieces, `src/api/` the calls, `test/` the Vitest tests. `/` is the join screen and `/host` is the host's entry; an unknown path goes to `/`. |
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
docker run --rm -p 3000:3000 -v coliseumgrid-data:/data \
  -e COLISEUMGRID_HOST_PASSWORD=change-this-password coliseumgrid
```

The image starts in online mode, which stops at startup without a host password, so pass one:
`-e COLISEUMGRID_HOST_PASSWORD=...` (at least 8 characters). The image sets
`COLISEUMGRID_MODE=online`, `PORT=3000`, and
`CLIENT_DIST=/app/packages/client/dist`. It also sets `DATA_DIR=/data`, which holds the
database (and later uploaded graphics), so mount a volume there.

`.github/workflows/docker.yml` is the Docker check. It builds the image, runs it, waits for
`/api/health` to return `{"status":"ok"}`, and fetches `/` to confirm it is the client's
HTML. Only then, and only on the default branch, does it push
`ghcr.io/bradbrownjr/coliseumgrid:edge` and a `sha-` tag. Pull requests build and test
without pushing. The dev box has no Docker, so this CI job is the only place the image runs.

`deploy/unraid/coliseumgrid.xml` is the Unraid template, following Pattern Break's. Its
data folder must belong to uid 1000 (`chown 1000:1000`), since the image runs as `node`.

Behind a reverse proxy, the proxy has to pass the browser's `Host` header through unchanged,
or every state-changing request fails the server's Origin check (`PLAN.md` section 3). Caddy
does this by default: its `reverse_proxy` docs say it passes incoming headers, `Host`
included, to the backend without modifications
(<https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>, "Defaults"). The same page
says Caddy rewrites `Host` automatically only for HTTPS upstreams, so point it at the
container over plain HTTP (`reverse_proxy coliseumgrid:3000`) and don't add `header_up Host`.
Set `TRUSTED_PROXY` to the proxy's address. The Origin check ignores the scheme, so HTTPS in
front of plain HTTP works.

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
