# Development guide

How to work on ColiseumGrid. The design is in [`PLAN.md`](PLAN.md); the writing rules are in
[`DOC-STYLE.md`](DOC-STYLE.md).

The code is in three packages: `packages/core` (the rules the browser and the server share),
`packages/server` (the API, the database, and live updates), and `packages/client` (the three
screens). The Layout table lists their files.

## Requirements

- **Node 26.** The version is in `.nvmrc`. Node runs TypeScript directly (type stripping),
  so `core` and `server` have no build step; only the client is built (by Vite).
- **pnpm 12.** The exact version is `packageManager` in the root `package.json`
  (`pnpm@12.21.0`).

### On the dev box

Development happens on Brad's Debian LXC container. For the tablets and a TV to reach a dev
server there, it listens on all addresses (Vite's `--host`), not only `localhost`.

## Commands

Run `pnpm install` once first.

| Command | What it does |
|---|---|
| `pnpm lint` | Oxlint over the whole repo. `packages/core/src` also bans `Math.random`, imports of Node built-ins (with or without `node:`), `ws`, and server packages, and DOM, Node, and network globals, read bare or through `globalThis`. A scratch import of a Node built-in also fails `typecheck`, because core has no Node types. |
| `pnpm typecheck` | `tsc` in every package, then `tools/`. `core` is checked twice: its source with ES2022 types only, its tests with Node types. `client` is checked three times: the app with DOM types, the push worker (`src/worker`, `test/worker`) with WebWorker types (`tsconfig.worker.json`), and `vite.config.ts` and `vite.push-assets.ts` with Node types. |
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
| `DATA_DIR` | `data` | The folder that holds the database file `coliseumgrid.db` and the uploaded event graphics (its `graphics` folder). Absolute, or relative to the working directory (the server turns it into an absolute path at startup). The server creates it if it is missing. The Docker image sets `/data`. |
| `TRUSTED_PROXY` | none | The reverse proxy's IP address. Only a request whose direct peer is this address may name the client in `X-Forwarded-For`, and only the last entry is used (`CLAUDE.md`, rule 6). Without it, the client is the socket address. Set it online, behind the proxy; without it every player shares the proxy's address and its rate limit, and the server prints a warning at startup. |
| `COLISEUMGRID_PUSH_SUBJECT` | none | The contact the push services see in the VAPID token (RFC 8292): a `mailto:` address or an `https:` URL, never `localhost` (`mailto:you@example.com`). A bad value stops the server at startup. Online without it, push is off and the server warns at startup; phones get the page alert only. Offline it is read and checked but has no effect, because push runs only in online mode, over HTTPS. |
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
  routes a Sign-up device or a host session, `GET /api/event` and `GET /api/live` any host,
  device, or phone (`requireViewer`), and the phone routes a phone that follows someone (401
  `not-following`, `requirePhone`). The check runs as an `onRequest` hook, before the body is read. A Display is
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

### Phones and push

`PLAN.md` section 3, "Player view" and "Phone API", is the contract. The server files are
`phone-routes.ts` (the routes), `phones.ts` (phones and their follows), `follow-codes.ts`,
`push-subscriptions.ts`, `push-notify.ts` (when to send), `web-push.ts` (the sender),
`vapid-keys.ts`, and `pin-guard.ts`.

- **One PIN check.** `pin-guard.ts` is the only place a PIN is checked against its limits.
  The tablet's claim (`checkClaim`) and the phone's follow (`checkFollow`) both go through it.
  It keeps two per-handle counts: the phone count locks phones, and online a wrong claim
  counts in it too; the tablet count locks the claim, and only wrong claims count in it, so
  phones never lock the tablet (`PLAN.md`, "Player view"). `allowFollowFrom` reserves the
  phone's per-IP try before `checkFollow`, and the route calls `refundFollowFrom` when the
  follow worked, so only wrong tries count toward the 60. An unknown handle goes to
  `rejectUnknownHandle`, which spends a hash and keeps no per-handle key. After the hash, the
  guard reads the player's PIN hash again and answers `wrong-pin`, uncounted, when it changed:
  a reset during the check must not let the old PIN through. The route's write follows the
  guard's answer with no `await` between, so keep it that way. A new route that checks a PIN
  calls the guard, not `verifyPin` directly. Anything that changes a handle's PIN or name
  calls `forget`.
- **Right codes refund, they don't clear.** The per-IP wrong-code counts are shared by
  pairing codes and follow codes, so a right code calls `refund` for its own try. `clear`
  would also forget the wrong codes of the other kind.
- **Live connections hold identities.** A connection can be the host, the laptop, a device, and
  a phone at once (one browser, several cookies). `hub.signOutPhone` and `hub.unpair` take away
  that one identity and close the connection only when none is left, so pass every identity
  the request has to `hub.attach`.
- **Phones that go idle.** `phones.touch` refreshes `last_seen` from `access.identify`, at
  most once a minute. `phone-purge.ts` deletes phones not seen for 90 days at startup and
  daily; follows and subscriptions go by cascade. `push-subscriptions.ts` keeps at most 10
  subscriptions per player (`trimPlayer`, called when a phone subscribes, follows, or a merge
  moves follows), and `push-notify.ts` sends at most 8 pushes at once.
- **The answer cache.** `competition.answer()` builds the bracket or groups answer once and
  keeps it, and every phone's `GET /api/phone` is worked out from it, so 30 phones don't
  each rebuild a round robin. It reads everything in its first tick, so one answer is one
  moment of the database, and callers who ask during a build share it.
  **Every write path calls `competition.drop()` after the write**: a save, start, delete,
  rename, merge, and event change (`bracket-routes.ts`, `heat-routes.ts`, `players-routes.ts`
  through `onCompetitionChanged`, and `host-routes.ts` through `onEventChanged`). A new route
  that changes what the answer holds must call it, or phones show stale data. Call it before
  `hub.broadcast`, so a phone that reloads at once gets the new answer.
  `phone-cache.test.ts` covers each path.
- **`onDrop`.** `drop()` also runs the listeners from `competition.onDrop`. `push-notify.ts`
  is the one listener: it schedules its check with `setImmediate`, so the check starts after
  the write has answered, and it never fails or slows a write. The tests wait for it with
  `app.pushIdle()`.
- **Push is off unless all of these hold.** Online mode, `COLISEUMGRID_PUSH_SUBJECT` set, a
  VAPID key that loads, and a request over HTTPS (`isHttps`). The key file
  `vapid-private-key.pem` (mode 0600) is in `DATA_DIR`. It is made the first time push needs
  it, which is the first `GET /api/phone/push` over HTTPS or the first send, and it is never
  replaced once there. Deleting it and restarting makes a new key, and each phone's page
  subscribes again with it the next time the page loads.
- **The worker and the manifest.** `src/worker/push-worker.ts` is built by
  `vite.push-assets.ts` (a plugin in `vite.config.ts`) into `push-worker.js` at the site
  root, and the plugin emits `manifest.webmanifest` beside it. The plugin runs a second,
  nested Vite build of the worker as one `iife` script: a service worker registered as a
  classic script can't import chunks, and the main build shares code into chunks. Both
  files keep fixed names, because a worker's scope is its folder and the browser compares its
  bytes to see a change. The worker imports only `pushNotification.ts`, which imports only
  `alertWords.ts`; keep what it imports that small. The manifest's colors come from
  `PALETTE` (`DESIGN.md`, "Player page (phone)").
- **`tsconfig.worker.json`.** The worker's files are checked with the `WebWorker` types and
  excluded from the app's `tsconfig.json`, because the `WebWorker` and `DOM` libraries
  declare the same globals differently and can't share one program.
- **Icons.** `packages/client/public/icons` holds `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`, and `apple-touch-icon.png`. `node tools/make-icons.ts` makes them
  from `assets/logo/icon.svg` on the light `background.default`, using Chromium through
  Playwright (`packages/core` depends on it; run `pnpm --filter @coliseumgrid/core exec
  playwright install chromium` once). Run it by hand when the logo or the palette changes,
  and commit the PNGs. Vite copies `public/` to the site root as is.
- **Testing push.** `pnpm dev` has a manifest but no worker, and push needs HTTPS and the
  server's key, so the page never offers it there. Try it on a production build (`pnpm build`,
  then the server in online mode with `COLISEUMGRID_PUSH_SUBJECT`) behind HTTPS with a
  certificate the phone trusts (see "Docker" for the proxy, and `PLAYTEST.md`, "Phones, over
  HTTPS"). The server speaks plain HTTP, so it counts a request as HTTPS only behind the proxy
  (`TRUSTED_PROXY` set, and the proxy sending `X-Forwarded-Proto: https`); a direct
  `localhost` request never gets a push key. The tests use a fake sender and fake keys (`push.send`,
  `push.loadKeys` in `buildApp`).
- **Phone page tests.** The words (`phoneWords.ts`), alert rules (`alerts.ts`), and push logic
  (`pushClient.ts`, `pushNotification.ts`) are plain functions, tested without a DOM. The
  push client reads the browser's globals when called, not when loaded, so tests stub them.

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
- **QR codes.** `lean-qr` makes one SVG path (`pairing.ts`, `components/QrCode.tsx`). The code is
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

### Brackets

The rules are in `PLAN.md`, sections 5 and 6. These are the facts a change has to keep.

- **The database holds inputs.** Migration 3 stores a bracket's settings, its seeding list, its
  late joins, its tie-break matches, and its result log; migration 4 adds the step and time of
  an older undo to a result's row. It doesn't store the library's state.
- **The log is results and older undos.** `BracketState.results` holds every result in the
  order recorded, and a result taken back by an older undo keeps its place with `undone: {
  step, at }`. `logOf` in `bracket-engine.ts` merges the two into the log, entry k being step
  k + 1. Undoing the newest entry removes the result instead, so the state is exactly the one
  before it.
- **Every answer is a replay.** `replayLibrary` in `bracket-library.ts` builds a new in-memory
  store, creates the stage from the seeding, and replays the log. At an older undo it starts a
  new store and replays the results still standing. It returns each stretch of steps during
  which a match was ready (`LibraryReady`), and the engine hands those to `buildQueue` as
  `QueueMatch` entries: a match ready twice has two, a reopened one is marked `reopened`, and
  one that lost a player carries `until`. The library's `reset.matchResults` and
  `update.seeding` aren't called: `reset.matchResults` left matches in the wrong state or
  threw, and `update.seeding` changed matches already played (`PLAN.md`, "Late sign-up" and
  "Brackets API").
- **An older undo moves no station.** `undoResult` accepts it only if every station keeps its
  match, `calledAt`, and players, and an idle station takes nothing but the reopened match.
  `test/bracket-undo-fuzz.test.ts` checks this over random play; keep it passing when the
  queue or the replay changes.
- **One file calls the library.** Only `bracket-library.ts` imports `brackets-manager`,
  `brackets-memory-db`, or `brackets-model`. Check with
  `grep -rn "brackets-" packages/server/src`.
- **Every change runs on the write chain.** A route that changes a bracket runs its work through
  `createWriteChain` (`write-chain.ts`), so two taps can't interleave.
- **Seeding takes the caller's random source.** `seedPlayers` in `packages/core/src/bracket-seeding.ts`
  takes it as an argument, so the tests fix the order.
- **Late joins fill the first empty slot.** `addLatePlayer` in core does it. The engine accepts the
  join only if every logged result and every called match still holds, and refuses with 409
  `late-closed` otherwise.
- **A step counts log entries,** results and older undos both. A late join and a tie-break
  record the step they were made at. The queue (`packages/core/src/queue.ts`) and the
  late-join check read steps.
- **Tie-break matches have their own ids.** They start at `TIE_BREAK_ID_BASE` (1000, in
  `bracket-engine.ts`) and never go to the library. The engine throws if a library match id
  reaches 1000, so library ids must stay below it.
- **Result ids are never reused** (`nextResultId`), so an old id can't name a new result.

### Heats

The rules are in `PLAN.md`, section 5 and "Heats API". These are the facts a change has to keep.

- **The heat engine mirrors the bracket engine.** `heat-engine.ts` takes a `HeatState` and
  returns the new state with its answer, or a refusal. Every answer is a replay: `rebuild`
  cuts round 1 from the seeding and works out later rounds, tie-break heats, and the final
  from the results standing at each step. None of that is stored. The engine reads no clock
  and touches no database; the route passes in the time and the new result's id.
- **The engine is synchronous.** A call finishes before the next one starts, so the write
  chain matters only against the bracket engine, whose writes await `brackets-manager`. Heat
  routes run on the chain too (`heat-routes.ts`). A route that lists a player in the event
  (`eventPlayers.add`) does it inside the chained task, after the store save, in both route
  files.
- **Heat ids.** A round heat is `round * 100 + number` (`ROUND_ID_STEP`). A round has at most
  8 heats (32 players in groups of 4), so round ids stay under 400. Tie-break heats start at
  1000 (`TIE_BREAK_HEAT_BASE`) and take their id from their place in the tie-break list. The
  final is 2000 (`FINAL_HEAT_ID`). The list only grows at the end or is cut back from the end,
  so an id never names two heats.
- **A late join's `step` is a record only.** `HeatLateJoin.step` is stored and moved back when
  an undo removes an earlier log entry, but `rebuild` doesn't read it. A join is accepted only
  into a heat that was never called, so seating the player from step 0 gives the same queue,
  scores, and rounds as seating them at `step`. Brackets differ: their queue and late-join
  check do read steps.
- **Only qualifying heats score.** `scoreHeats` counts qualifying heats alone, so tie-break
  heats and the final add no points and don't count toward `heatsPlayed`.
- **One competition per event** is in `competition.ts`. `running` checks the bracket and the
  heats. `startBracket` and `startHeats` each replace a finished competition of the other
  kind in one transaction. `hasPlayer` backs the merge guard (409 `in-bracket`, checked in
  `app.ts`). Both kinds' routes call it, so change the rule there, not in a route.
- **`inTransaction` nests through savepoints.** Inside another transaction it runs as
  `SAVEPOINT nested_N`. So `heat-store.save` and `bracket-store.save` can run inside
  `startHeats` or `startBracket`, and the swap is all or nothing.
- **Shared words.** `heatsWords.ts` (the cut line and its "Top N go to the final" label, the tie sentence, and the "no results yet"
  check) and `handles.ts` (the handle list) are read by the host (`pages/host/groupWords.ts`,
  `GroupsBody.tsx`) and the Display (`HeatsScreen.tsx`). Change them once, there.
- **The store rewrites a run whole.** `heat-store.save` rewrites all of a run's rows in one
  transaction, so the database equals the state exactly. A run's settings never change once
  made. Its tables come from migration 5; never edit that entry.

### Setup wizard, estimate, and no-shows

The rules are in `PLAN.md`, sections 3, 5, and 6. These are the facts a change has to keep.

- **Migrations 7 and 8.** Migration 7 adds `events.game` (the typed game name, null for
  none), `events.plan` (the plan as JSON), `bracket_results.forfeit` (0 or 1), and
  `heat_results.missing` (a JSON list of player ids, null for none). Migration 8 adds `at` to
  `bracket_tie_breaks` and `heat_tie_breaks` (when the host pressed **Play tie-break**; null on
  a row from before, which is called at the last result's time as it was), and the tables
  `bracket_arrivals` and `heat_arrivals`. Every column has a default, so older rows migrate
  as they were.
- **The plan is checked at the edge.** `EventPlan` and `isEventPlan` are in
  `packages/core/src/event-plan.ts`. `PUT /api/event/plan` answers 400 `bad-request` unless
  `isEventPlan` accepts the body, and its schema is closed. The stored JSON is read back
  through `isEventPlan` (`readPlan` in `events.ts`), so a plan that is unreadable is as good
  as none. Add a plan field in three places together: the interface and `PLAN_KEYS`, the
  checks in `isEventPlan`, and `planSchema` in `api-schemas.ts`.
- **A competition keeps its own settings.** The wizard sends the settings when it starts a
  bracket or groups, so changing the plan never changes one that is running. The one plan
  value a running competition reads is `noShowMinutes`, which the answers carry.
- **The `plan` live message has no payload.** `PUT /api/event/plan` and `POST /api/events`
  broadcast `{ type: 'plan' }`. `HostScreen` counts it in `planVersion`, and `SetupWizard`
  reads the plan again when that changes or the step changes. It skips the read while it
  holds a change that isn't saved or a save is in flight (`readAgain`), so a second host
  window never overwrites typing. `planSaves.ts` sends the saves one after another, so the
  server ends with the last change made, and **Start** waits for `settled()` and starts from
  the plan the server answered with.
- **Server time.** Every bracket and heats answer (`GET`, and each change) has `now` beside it,
  read when the answer is sent and never kept with the cached answer. A station's `calledAt`
  is the server's time, so the screens count from the server's clock: `api/clock.ts` keeps the
  offset from each answer (`withServerClock`, in `api/bracket.ts` and `api/heats.ts`), and
  `useNow` counts in server time. Don't read `Date.now()` for anything compared to `calledAt`.
- **Arrivals are not results.** **They're here** (`POST /api/bracket/arrived` and
  `/api/heats/arrived`, host only) stores the match or heat and the `calledAt` of the call it
  was tapped for. A match called again has a new `calledAt`, so its wait starts over. Arrivals
  are not in the result log, so no step, standing, or undo reads them, and undo exactness is
  unaffected. The answer's `arrived` is true only for the station's current call.
  `arrivalsKept` drops the arrivals of tie-break matches an undo removed, because a new
  tie-break reuses their ids.
- **A tie-break has its own time.** `startTieBreak` and `startHeatTieBreak` take the time of
  the press, stored in the tie-break's `at`. `buildQueue` receives it as `QueueMatch.readyAt`,
  and a station it fills is called at `readyAt` or at the step's time, whichever is later. A
  tie-break is called when **Play tie-break** is pressed, not when the last result went in.
- **`noShowMinutes` is a trailing parameter.** The answer functions (`bracketAnswer`,
  `recordResult`, `undoResult`, `joinLate`, `setArrived`, `heatsAnswer`, and the heat
  equivalents) take it last, defaulting to `NO_SHOW_DEFAULT`. The routes pass
  `competition.noShowMinutes()`, which reads the event's plan. A new answer function takes it
  the same way, so the answer says when the wait is over.
- **Forfeits and missing players are in the log.** A bracket result has `forfeit`, and a heat
  result has `missing`; both ride the result log and the replay, so undo restores the answer
  exactly (`bracket-forfeit.test.ts`, `heat-missing.test.ts`). `order` and `missing` together
  must be the heat's players, and `scoreHeats` gives a missing player 0 points. Only ids are
  stored (`CLAUDE.md`, rule 1).
- **New events.** `POST /api/events` runs on the write chain, refuses with 409 `bracket-running`
  while a competition is running, copies the current plan (not the game), and drops the phone
  answer cache before it broadcasts `event`, `players`, `bracket`, `heats`, and `plan`. The old
  event's bracket stays in the database.
- **The estimate.** `estimatePlan` in `estimate.ts` is pure and numeric; the client words it
  (`wizardWords.ts`). Elimination waves come from `simulateWaves`, which plays the engine's real
  round sizes out on the live stations; the `PLAN.md` formula undercounts with several
  stations. `suggestFixes` re-runs the estimate for each change and keeps the two that save the
  most.
- **The calibration test.** `packages/server/test/estimate-calibration.test.ts` plays each
  format through the real engines in batches (every match or group on a station at one moment)
  for 12 sizes, 5 station counts, and 3 seeds, and counts the batches. They must fall within
  `[low - tol, high + tol]`, with `tol = max(1, ceil(10% of high))`. The tolerance is the
  plan's; don't widen it to make a case pass. Round robin runs are capped at 12 players. The
  estimate counts one tie-break round of 3 matches, so a round robin run with more tie-break
  matches is left out of the check and counted instead; that count must stay under 15% of the
  round robin runs. Each case allows 600 s.
- **The name dice.** `event-names.ts` holds the word lists for each template and
  `eventName(template, random)`, which takes a seeded source (the page seeds one from
  `crypto.getRandomValues`, `random.ts`). `event-names.test.ts` runs every name the lists can
  make (`allEventNames`) through `isVulgar`, as written and with the spaces removed; checks
  that none is over 60 characters or has anything but printable ASCII; and checks that no word
  repeats, compounds included ("Stormstorm"). The lists must hold no game title or game
  company (`CLAUDE.md`, "Always and never"). A test can't check that, because it would have to
  hold the names, so a reviewer reads the lists and reads each new pairing, since two ordinary
  words can read as a title.
- **Checking the whole flow in a browser.** The sandbox blocks loopback, so M7 was checked
  against a throwaway container on the Unraid server, driven by a Playwright script kept
  outside the repo. Build the image, run it on a spare port with a fresh data folder, run the
  script against that address, then remove the container and its folder. The script isn't committed.

### Name tags

The rules are in `PLAN.md` section 7. These are the facts a change has to keep.

- **Migration 9.** `events` gains `graphic_file`, `graphic_type`, `graphic_width`, and
  `graphic_height`, all null for no graphic and written together (`Events.setGraphic`). The file
  name is a `newToken()` (`tokens.ts`), so it is random, made by the server, and also the
  graphic's `version` and ETag. `tag_queue` holds one row per player (deleted with the player):
  `pin`, the plain 4-digit PIN or null, `pin_stored_at`, both or neither, and `queued_at`. It
  has no event column: a new event empties it, as it starts with no players.
- **Where a tag is queued.** `players-routes.ts` calls `tags.queue` on sign-up, claim, host
  add, and PIN reset, in the same tick as the write that stored the PIN, with no `await`
  between. The claim relies on `pin-guard.ts` having checked that the hash didn't change during
  its check, so keep the claim's queue call before any `await`. A reprint (`POST /api/tags`)
  queues no PIN and keeps a PIN already queued, with its time, so the newest PIN prints and its
  12 hours count from when it was seen.
- **A PIN leaves the file.** `openDatabase` turns on `PRAGMA secure_delete`, which zeroes
  deleted content, and `tag-queue.ts` runs `PRAGMA wal_checkpoint(TRUNCATE)` after any change
  that removes a PIN (printed, wiped, cleared, merged away), because the WAL keeps older copies
  of a page. `tag-pins.test.ts` reads the file and its WAL and fails without either step.
- **The 12-hour wipe.** `tag-pin-wipe.ts` runs `wipeOldPins` at startup and hourly, like
  `phone-purge.ts`, with a timer that is `unref`'d and stopped when the app closes. It reads the
  app's clock (`now`), so tests move time by hand.
- **Host screens only.** The queue's live message goes through `hub.broadcastToHosts`, which
  sends only to connections that signed in as the host (a session, or the laptop). Every queue
  change calls `onTagsChanged`; a change to the event (the graphic) is an ordinary `event`
  broadcast and drops the phone answer cache, because a phone's answer has the event.
- **The upload.** `name-tag-routes.ts` registers `PUT /api/event/graphic` in its own plugin
  scope, which has the raw body parser for the three image types (2 MB limit) and an error
  handler that turns 413 and 415 into `too-large` and `bad-type`. Other routes keep app.ts's
  handler and still refuse an image body. `imageInfo` (`packages/core/src/image-info.ts`) reads
  the type and size and walks the file's structure to its end, so a cut-off file is refused.
  The file is written before the database changes and deleted again if the change fails; a
  replaced file is deleted after it once no event uses it (a new event copies the graphic).
- **The data folder.** `buildApp` takes `dataDir`; the graphics go in its `graphics` folder,
  made on the first upload. Without it, `buildApp` makes a temporary folder and deletes it on
  close, which the tests use.
- **Label sizes.** `packages/core/src/name-tags.ts` holds the presets, the 3 mm safe edge, the
  custom size limits, and the graphic limits, so the print page and the server share them.
- **The client's name tag files.** `pages/host/NameTagsPanel.tsx` is the Name tags panel (the
  label size, the two print buttons, the picture, and the "Did all 5 tags print?" dialog);
  `labelSetting.ts` keeps the chosen size in `localStorage`, every use wrapped in try/catch;
  `nameTagWords.ts` has the panel's words. `PrintSheet.tsx` is the print view and `TagFace` one
  page of it; `printLayout.ts` holds the print numbers and the fit. `api/tags.ts` has the calls
  (`call` sends a `Blob` as it is, with its own type, for the upload), and
  `components/EventPicture.tsx` shows the graphic on the host panel and the TV.
- **The print view.** `PrintSheet` is a portal into `<body>`, mounted only while a job runs.
  On screen it is `visibility: hidden`; `printCss` sets `@page { size; margin: 0 }` and, under
  `@media print`, hides every other child of `<body>` (the app, its dialogs, its snackbar). A
  page is the label's size with `break-after: page`; the tag inside is drawn wide and, on a page
  taller than wide, turned a quarter turn clockwise (`rotate(90deg)` from the top left,
  moved right by the page width). Content sits 3 mm inside the edge (`LABEL_SAFE_EDGE_MM`).
- **Print units are the exception to the theme.** `printLayout.ts` is the one file that uses
  millimetres, points, and the color names `black` and `white`, because paper has a physical
  size and a one-color printer has no theme (`DESIGN.md`, "Name tags"). Everything else in the
  client keeps to the theme.
- **Fitting the handle.** Millimetres and points are absolute in a browser, so the handle is
  measured on screen in the hidden sheet and prints the same. `PrintSheet` loads the handle's
  font face first (`document.fonts.load`), then `fitPoints` finds the largest size, in half
  points from 72 down, whose `offsetWidth` fits 97% of the row (`FIT_SLACK`: print lays text out
  a hair differently from the screen). A handle that needs under 28 points keeps shrinking to
  12 instead of crossing the edge; 16 ordinary characters fit at 28, but 16 capital M and W do
  not. The result is in each handle's `data-pt` attribute, which the print check reads.
- **The print flow.** A job is `queue` (the tags loaded now) or `test`. When the sheet reports
  ready, the panel calls `window.print()` once, and the `afterprint` event ends the job. A
  queue job then asks "Did all 5 tags print?"; **Yes** posts exactly the ids that were printed,
  not the queue as it is by then. The test tag asks nothing and never touches the queue.
- **Checking a print.** `window.print()` can't run headless, so a script replaces it with a
  counter, waits for it, calls `page.pdf({ preferCSSPageSize: true, printBackground: true })`,
  fires `afterprint` by hand, and then reads the PDF page sizes with `pdfinfo` and looks at
  `pdftoppm -png -r 150` pages. Chrome rounds a page to whole points, so sizes agree to about
  0.2 mm, inside the 0.5 mm the roadmap allows.

## Layout

| Path | What it holds |
|---|---|
| `packages/core` | `@coliseumgrid/core`: rules shared by the browser and the server (see `PLAN.md` section 9): the seeded random source, handles and the vulgarity filter, PINs, join codes, bracket seeding, the station queue, tie ranking, heats (`heats.ts`), the event plan (`event-plan.ts`), the time estimate (`estimate.ts`), the name dice word lists (`event-names.ts`), the label sizes and graphic limits (`name-tags.ts`), the image header reader (`image-info.ts`), and the API types. `test/fixtures/` holds the image files the core and server tests read, with a README saying how each was made. |
| `packages/server` | `@coliseumgrid/server`: `src/app.ts` builds the Fastify app (`buildApp`), `src/config.ts` reads the settings, `src/main.ts` starts it, `src/database.ts` holds the schema, `src/players-routes.ts` the players API, `src/pin-hash.ts` PIN and password hashing (scrypt), `src/client-ip.ts` and `src/rate-limit.ts` the client address and the guessing limits, `src/access.ts`, `src/host-routes.ts`, `src/devices.ts`, `src/host-store.ts`, `src/events.ts` (events, their game and plan), and `src/live.ts` host sign-in, pairing, the event and plan routes, and live updates. The bracket files are `src/bracket-engine.ts` (a bracket's state and each change to it), `src/bracket-library.ts` (the only file that calls brackets-manager), `src/bracket-store.ts` (its tables), `src/bracket-routes.ts` (the bracket API), `src/write-chain.ts` (one write at a time), and `src/event-players.ts` (who is in the event). Arrivals ("They're here") are in `bracket_arrivals` and `heat_arrivals`, saved by the two stores. The group files are `src/heat-engine.ts` (a group's state and each change to it), `src/heat-store.ts` (its tables), `src/heat-routes.ts` (the groups API), and `src/competition.ts` (one competition per event, for brackets and groups, and the kept answer the phones read). The phone files are `src/phone-routes.ts`, `src/phones.ts`, `src/follow-codes.ts`, `src/pin-guard.ts` (the one PIN check), `src/push-notify.ts`, `src/push-subscriptions.ts`, `src/web-push.ts` (the sender on `node:crypto`), and `src/vapid-keys.ts`. The name tag files are `src/name-tag-routes.ts` (the graphic and tags routes), `src/tag-queue.ts` (the print queue), and `src/tag-pin-wipe.ts` (the 12-hour PIN wipe); the graphic's columns are in `src/events.ts`. |
| `packages/client` | `@coliseumgrid/client`: Vite, React, and MUI. `src/theme/` holds the palette and the theme, `src/pages/` the Host (`/host`), Sign-up (`/signup`), and Display (`/display`) screens, `src/components/` shared pieces (`useNow.ts` is the timer hook, counting in the server's time), `src/api/` the calls (`bracket.ts` for brackets, `heats.ts` for groups, `clock.ts` the offset between this device's clock and the server's, read from the `now` in each answer), `src/pages/host/SetupWizard.tsx` the setup wizard (its steps are in `WizardSteps.tsx`, its words and small calculations in `wizardWords.ts`), `src/pages/host/planSaves.ts` the queue that saves the wizard's plan one change after another, `src/noShow.ts` when a station's wait is over and the call line, `src/random.ts` the page's random source for the name dice, `src/pages/host/` and `src/pages/display/` the bracket and group pieces of the Host and the TV, `src/heatsWords.ts` and `src/handles.ts` the words and handle lists both screens read, `test/` the Vitest tests. `src/pages/phone/` the player page at `/follow` (cards, alerts, the push control and its client), `src/worker/` the push service worker (checked by `tsconfig.worker.json`), `public/icons/` the Home Screen icons, `vite.push-assets.ts` the plugin that builds the worker and the manifest. `/` is the join screen and `/host` is the host's entry; an unknown path goes to `/`. |
| `tools/` | Scripts run by hand or in CI, type-checked by `tools/tsconfig.json`. `make-icons.ts` makes the Home Screen icons (see "Phones and push"). |
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
- **The uuid override.** `pnpm-workspace.yaml` sets `brackets-manager>uuid` to 14.0.3.
  brackets-manager 1.11.1 asks for uuid 9, which has the advisory GHSA-w5hq-g745-h8pq. The
  library calls only uuid v4. Remove the override when brackets-manager moves off uuid 9, and
  run `pnpm audit --audit-level high` before and after.
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
database and the uploaded graphics, so mount a volume there.

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

- The server suite takes about 115 s (measured 2026-11-15 on the dev box, 1298 tests passing, with M8's server work; the slowest file is still `phone.test.ts`, about 70 s run alone). Each PIN and the host
  password is hashed at the production scrypt cost (`pin-hash.ts`), and
  `packages/server/vitest.config.ts` allows 30 s per test. A test that signs in several times
  needs that room.
- Vitest for `core`, `server`, and `client`. Client tests need no DOM: they build the theme and
  call its overrides, and render a component with `renderToString`. Server tests build the app with `buildApp` and call
  `app.inject`, so they open no port. Formats are tested with seeded randomness and fixed
  results, across every player count the roadmap names.
- `core` has two Vitest projects (`packages/core/vitest.config.ts`): `node` runs every test, and
  `browser` runs `vulgarity.test.ts` and `handle.test.ts` in headless Chromium through
  `@vitest/browser-playwright`, so the filter is proven in the build the client ships.
- **Name tag tests.** `packages/core/test/image-info.test.ts` reads each fixture in
  `packages/core/test/fixtures/` (PNG; baseline and progressive JPEG; lossy, lossless, and
  extended WebP), cuts each off at every byte, and patches headers by hand to break each rule.
  The server's `graphic.test.ts` uploads the same files; `name-tags.test.ts` covers the queue
  routes, who may call them, and the host-only live message; `tag-pins.test.ts` covers the
  12-hour wipe and checks the database file. A 4-digit PIN alone could appear anywhere in a
  file, so that check searches for the PIN followed by its `pin_stored_at` time, which is how
  SQLite lays out the row, and first finds it there while the tag is queued.
- **Client name tag tests.** `printLayout.test.ts` covers the geometry, the graphic box, the type
  sizes, `fitPoints` (with stand-in measurers, since there is no DOM), and the print rules;
  `labelSetting.test.ts` the saved size and blocked storage; `nameTags.test.tsx` the words, a
  tag page, the panel, **Print tag**, and the calls. The browser-only parts (the font loading
  and the real fit) are checked by printing to PDF against a production build.
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
