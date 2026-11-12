# ColiseumGrid build plan

> This is the design. What gets built next is in [`ROADMAP.md`](ROADMAP.md), what is
> finished is in [`CHANGELOG.md`](CHANGELOG.md), the UI rules are in
> [`DESIGN.md`](DESIGN.md), and how to work on the code is in
> [`DEVELOPMENT.md`](DEVELOPMENT.md). Nothing here is built unless the changelog says so.

## 1. Pitch

A tournament app for an afternoon of video games in one room. Kids sign up at a tablet with
a gamer handle and get a printed name tag. The host runs the event from a laptop: 1 vs 1
brackets for games like Super Smash Bros., and race heats for games like Mario Kart. A TV
shows the bracket, the standings, who plays next, and a match timer. Handles are remembered,
so a player's results carry over from one event to the next.

It runs with no internet on a laptop and a travel router, or online from a Docker image.

The first event is on July 10, 2027.

## 2. Principles

1. **A 12-year-old can host it.** The setup has three steps, with the defaults filled in.
   Everything else is under "More options". Every screen is written for a kid to read (see
   `DOC-STYLE.md`).
2. **Offline first.** Every feature works with no internet connection. Fonts, icons, and
   images are bundled; nothing is loaded from a CDN at runtime.
3. **Handles only.** A player is a handle and an optional PIN. No names, email addresses,
   photos, birthdays, or accounts.
4. **One rule, one place.** The rules a tablet checks while a kid types (handles, the
   vulgarity filter, PINs) and the tournament formats live in `packages/core`, which runs in
   the browser and on the server. The server's answer is the one that counts.
5. **Every result can be undone.** A host who taps the wrong winner fixes it with one undo,
   and the bracket rolls back with it.
6. **Current dependencies.** Libraries are kept at their latest releases, and a known
   vulnerability fails the build (see `DEVELOPMENT.md`, "Dependencies").

## 3. Devices and screens

| Device | Screen | What it does |
|---|---|---|
| Laptop | Host | Creates the event, starts rounds, records results, undoes mistakes, pairs devices, prints name tags |
| Tablet | Sign-up | A player types a handle, keeps or changes the suggested PIN, and gets a name tag |
| TV | Display | Shows the bracket or standings, "Up next", the console to go to, and the match timer. No input |

One console is the starting point, with room for a second. Each console is a **station**,
and the queue sends the next match to the first free station.

### Pairing a device

The host screen shows the join address, a 6-character code, and a QR code.

- The address opens straight to the join screen, so a TV remote only types the host and
  port (for example `http://10.0.0.5:8080`).
- The code uses letters and digits that can't be mistaken for each other (no 0, O, 1, I,
  or L) and is shown as two groups of three: `K7M-4QX`. A code works once, expires after 10
  minutes, and wrong guesses are rate limited.
- The QR code holds the address with the code filled in. A tablet's camera app opens it;
  the page itself never uses the camera.
- After the code, the device is set as **Display** or **Sign-up**. It keeps a device token
  and reconnects by itself at the next event if the address is the same. The host can
  unpair any device.

Keeping the address the same is the host's job: a DHCP reservation for the laptop on the
travel router. `PLAYTEST.md` covers checking this on the real router.

### Host sign-in

Host screens need a host session.

- **Offline mode:** the launcher opens the host screen on the laptop itself (`localhost`)
  and signs it in. From any other address, the host password is needed.
- **Online mode:** the host password is always needed. The `localhost` sign-in is off,
  because behind a reverse proxy every request arrives from `localhost`.

## 4. Players

### Handles

- 2 to 16 characters (Brad, 2026-11-12): letters, digits, spaces, and `. - _`. Shown as typed, compared
  without regard to case, so `Zap` and `ZAP` are the same player.
- The vulgarity filter is a port of Pattern Break's `packages/core/src/name.ts`: roots that
  count anywhere in a handle, roots that count only as a whole word (to avoid blocking
  innocent words like "class"), and two readings of each handle (look-alike digits read as
  letters, and runs of single letters joined, so `A.S.S` fails). Its tests of innocent names
  come with it. The port changes it for mixed case and the longer length.
- The host can rename a player and merge two players into one.

### PINs

- Sign-up fills in a random 4-digit PIN. The player keeps it or types their own; deciding
  never holds up the line (Brad, 2026-11-12).
- The PIN prints small in a corner of the name tag.
- When someone types a handle that is already taken, they enter its PIN or pick another
  handle.
- PINs are stored hashed (`scrypt` from `node:crypto`). A 4-digit PIN can't stop a
  determined guesser; it stops one kid from playing as another by accident or for a laugh.
  Online, PIN attempts are rate limited.
- The host can reset any PIN.

### Stats

Each handle keeps, across events: events played, matches won and lost, heat points, and best
finish. Season standings come later (see `ROADMAP.md`, "Later").

## 5. Formats

The setup wizard offers three cards. Each has its options under "More options".

| Card | Formats | Engine |
|---|---|---|
| **1 vs 1 bracket** | Single elimination; double elimination ("two lives": out after a second loss) | `brackets-manager` |
| **Everyone plays everyone** | Round robin | `brackets-manager` |
| **Races and free-for-all** | Heats of up to 4 players with placement points | `packages/core` |

### 1 vs 1 bracket

- Best of 1, 3, or 5.
- Seeding: random, or by past results for returning handles.
- Byes go to the top seeds. On screen a bye reads as "Moves on this round" (see
  `DOC-STYLE.md`, "Tournament words on screen").

### Races and free-for-all

The same engine runs Mario Kart races and 4-player Smash free-for-alls: a heat is a group
of players, and each finishing place earns points.

- Heat size: up to the station's player count (4 for the games planned).
- Points table: editable, with a default of 4, 3, 2, 1 for first to fourth.
- Races per heat: 1 to 4.
- Rounds: each round regroups players by points so far. The top players by points go to a
  final heat.
- Tie-breaks are an open decision (see `ROADMAP.md`).

### Teams

Smash supports 2 vs 2. The data model has an entry hold one or more players from the start,
so teams can be added without a rewrite. The screens are built for single players first.

### Time estimate

Setup shows an estimated finish time: matches, times minutes per match, divided by
stations. It warns when a format won't fit the afternoon. For example, 16 players in double
elimination is 30 or 31 matches; at 7 minutes each on one console that's about 3.5 hours.
Everyone plays everyone with 16 players is 120 matches.

## 6. Running an event

1. **Create:** name, game, format card, start. The event can carry a graphic for the name
   tags and the TV.
2. **Sign-up:** tablets take players; the host can add players by hand.
3. **Play:** the queue sends matches to stations. The TV shows "Up next" and the timer. The
   host records each result with one tap (1 vs 1) or by tapping players in finishing order
   (heats).
4. **Finish:** final standings on the TV. Results go to each handle's stats.

## 7. Name tags

- Printed through the browser's print dialog, so any printer with an operating system
  driver works. Label sizes are CSS `@page` presets.
- A tag has the event graphic, the handle in large type, the event name, and the PIN small
  in a corner.
- Which printer and label size to support first is checked on real hardware (see
  `PLAYTEST.md`).

## 8. Deployment

### Online: Docker image

- `ghcr.io/bradbrownjr/coliseumgrid`: the server and the built client in one image, with
  a `/data` volume for the database and uploaded graphics. Same pattern as Pattern Break's
  `Dockerfile` and `docker.yml` workflow.
- Runs behind a reverse proxy that provides HTTPS.
- `COLISEUMGRID_MODE=online` turns off the `localhost` host sign-in and turns on rate limits.
- The client IP for rate limits is the last `X-Forwarded-For` entry, and only when the
  direct peer is the proxy. The first entry is set by the caller and can't be trusted (the
  lesson from MEPN's `get_client_ip`).

### Offline: portable bundle

- A download for Windows x64 and Linux x64 (Fedora), built in CI and attached to each GitHub
  release: the Node runtime, the built app, and a launcher that starts the server and opens
  the host screen.
- Node's single executable applications feature would make this one file, but its Node
  26.13.1 docs mark it "Active development" (checked 2026-11-12). The bundle ships the Node
  runtime beside the app until that changes.
- The database is `node:sqlite`, built into Node, so the bundle has no native modules to
  build for each operating system. Its Node 26.13.1 docs mark it "Release candidate"
  (checked 2026-11-12). The fallback is `better-sqlite3`.
- Windows Firewall asks to allow the server on private networks the first time it runs.
- On Fedora, Podman can run the Docker image instead.

### The TV

- A TV stick or a small PC opens the display page in a browser. Android TV devices usually
  don't include a full web browser, so one is installed from the Play Store.
- The page can't keep the TV awake on a local `http` address: the Screen Wake Lock API needs
  a secure context (`https` or `localhost`). The TV device's own sleep and screensaver
  settings are turned off instead. Online over `https`, the page holds a wake lock.

## 9. Tech stack

Versions checked 2026-11-12 at the start of M1. Pin exact versions in the lockfile; recheck at the start of each
milestone.

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 26 LTS (26.13.1) | Runs TypeScript directly (type stripping), as in Pattern Break |
| Package manager | pnpm 12.18.0 | Workspaces: `core`, `server`, `client` |
| Language | TypeScript 7.0.2, strict | `erasableSyntaxOnly` on, so Node can run every file |
| Lint | Oxlint 1.93.0 | TypeScript 7 has no compiler API yet, so no typescript-eslint |
| Tests | Vitest 5.1.0; Playwright 1.65.0 | Playwright for screen tests and screenshots |
| Server | Fastify 5.12.8 | With `@fastify/websocket` 11.3.7, `@fastify/static` 10.1.10, `@fastify/rate-limit` 11.2.2 |
| Database | `node:sqlite` | See section 8 |
| Brackets | `brackets-manager` 1.11.1 | MIT; last release 2026-09-20 |
| Client build | Vite 8.3.8, `@vitejs/plugin-react` 6.3.0 | |
| UI | React 19.3.1, MUI (Material UI) 9.5.0, `@mui/icons-material` 9.5.0, React Router 8.5.1 | MUI was Brad's choice (2026-11-12) |
| Styling engine | `@emotion/react` 11.14.0, `@emotion/styled` 11.14.1 | Peer dependencies of MUI 9.5.0 |
| Fonts | `@fontsource/roboto` 5.3.0 | Bundled for offline use |
| QR codes | `lean-qr` 2.7.4 | MIT, no dependencies, SVG output through `lean-qr/extras/svg`; released 2026-09-07. Replaces `qrcode`, whose last release was 2024-08-05. Its code makes no network requests (checked 2026-11-12) |

### Packages

- **`packages/core`**: handles, the vulgarity filter, PIN rules, heats, the time estimate,
  and the wrapper around `brackets-manager`. No DOM, Node, or network imports. Randomness
  (seeding, suggested PINs, heat groups) comes from a seeded source passed in by the caller,
  so every format can be tested with fixed results.
- **`packages/server`**: Fastify, the database, WebSockets, pairing, host sign-in, and
  serving the built client.
- **`packages/client`**: the Host, Sign-up, and Display screens.
