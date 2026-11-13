# Roadmap

*Last updated: 2026-11-13*

## At a glance

What comes next for ColiseumGrid, in build order. The first event is on July 10, 2027;
everything through M10 is meant to be done and play-tested before then. Finished items leave
this page and are recorded in the [changelog](CHANGELOG.md). The design behind every item is
in [`PLAN.md`](PLAN.md).

| Item | What it delivers | Stage |
|---|---|---|
| [M2 Players and sign-up](#m2-players-and-sign-up) | Handles, the vulgarity filter, PINs, and the Sign-up screen. | Next |
| [M3 Pairing and live screens](#m3-pairing-and-live-screens) | Join codes, QR codes, device roles, live updates, and the Display screen's frame. | Planned |
| [M4 1 vs 1 brackets](#m4-1-vs-1-brackets) | Single and double elimination, round robin, stations, the queue, and undo. | Planned |
| [M5 Races and free-for-all](#m5-races-and-free-for-all) | Heats with placement points, rounds, and a final. | Planned |
| [M6 Player view](#m6-player-view) | Players follow their own matches and standings on their phones, with an alert when they're up next. | Planned |
| [M7 Setup wizard](#m7-setup-wizard) | The three-step setup and the time estimate. | Planned |
| [M8 Name tags](#m8-name-tags) | Event graphics and printed name tags. | Planned |
| [M9 Packaging](#m9-packaging) | The offline bundle for Windows and Fedora, and the Docker image for online use. | Planned |
| [M10 Player stats](#m10-player-stats) | Each handle's results across events. | Planned |
| [Later](#later) | Teams, Swiss, pools, season standings, and a public results page. | Later |

**Stages:** *Next* is being worked on or starts as soon as the current item is finished.
*Planned* is settled and waiting its turn. *Later* has no plan of its own yet.

Each milestone is finished only when its acceptance checks pass. Work them in order; don't
start the next until the current one is done.

---

## M2 Players and sign-up

Tasks:

- Handle rules and the vulgarity filter in `packages/core`, ported from Pattern Break's
  `name.ts` with its innocent-name tests (see `PLAN.md` section 4).
- PIN suggestion, hashing, and checking.
- When the server first imports `packages/core`, add `"@coliseumgrid/core": "workspace:*"` to
  the server's `package.json`. The Docker image installs only the server's declared
  dependencies, so an undeclared import works locally and fails in the image.
- Database tables for players and events.
- The Sign-up screen: handle, PIN, done. The host's player list: add, rename, merge, reset
  PIN.

Acceptance checks:

- Filter tests pass for the vulgar and innocent lists, in Node and in the browser build.
- The server refuses a vulgar handle even when the client check is skipped.
- A taken handle asks for its PIN.

**Docs:** `PLAN.md` section 4, `DEVELOPMENT.md`.

## M3 Pairing and live screens

Tasks:

- Join codes and QR codes, device roles, device tokens, and unpairing (`PLAN.md` section 3).
- Host sign-in for both modes. Until then the host's actions (the player list's add, rename,
  merge, and PIN reset) answer any device on the network, by Brad's choice for LAN testing
  (2026-11-12). This task closes them in both modes.
- WebSocket updates from the server to every paired screen.
- The Display screen's frame: event name, "Up next", the timer.

Acceptance checks:

- A code works once, expires after 10 minutes, and wrong guesses are rate limited.
- In online mode, a request from `localhost` still needs the host password.
- A change on the host screen shows on a paired display within a second on the local
  network.

**Docs:** `PLAN.md` section 3, `DESIGN.md` (TV type size), `PLAYTEST.md`.

## M4 1 vs 1 brackets

Tasks:

- Single elimination, double elimination, and round robin through `brackets-manager`.
- Best of 1, 3, or 5. Random seeding.
- Stations and the queue. One-tap results with undo.
- The bracket on the Display screen.

Acceptance checks:

- Tests run every bracket size from 2 to 32 players in each format to a finish, with byes
  and the double-elimination final's rematch.
- Undoing any result restores the bracket exactly as it was.

**Docs:** `PLAN.md` section 5.

## M5 Races and free-for-all

Tasks:

- Heats, the points table, races per heat, regrouping by points, and the final, in
  `packages/core`.
- Recording a heat by tapping players in finishing order. Undo.
- Heat standings on the Display screen.

Acceptance checks:

- Tests run every player count from 2 to 32 to a final.
- Ties are settled by the rule chosen in "Open decisions".

**Docs:** `PLAN.md` section 5.

## M6 Player view

A player follows their own matches on their own phone, so the host spends less time waiting
for players at the concession stand or the bathroom (Brad, 2026-11-13). Design: `PLAN.md`
section 3, "Player view".

Tasks:

- Sign-in on a player's phone with handle and PIN, reusing M2's claim and its limits. A
  device token keeps the phone signed in.
- A QR code on the Sign-up done screen that signs a phone in without typing. It follows the
  pairing code rules: works once, expires after 10 minutes, rate limited (`CLAUDE.md`, rule
  7).
- One phone can follow several handles (a parent with two kids).
- The player page: the next match or heat, how many matches away it is, the station, and
  standings, updated live over M3's connection.
- The alert when a followed player is up next: a full-screen flashing banner, a page title
  change, a sound (unlocked by a first tap), and a vibration where the browser supports it.
- Over HTTPS: Web Push notifications through a service worker, which also needs a Home
  Screen web app on iPhone and iPad (iOS 16.4 and later), and a screen wake lock while the
  page is open. Offline over plain HTTP, the page alert is the only alert.

Acceptance checks:

- A phone signs in by handle and PIN, and by the QR code; a used or expired code is refused.
- When a followed player's match is two away, the page shows it within a second of the host
  recording the result before it.
- Over HTTPS, a subscribed phone gets a push notification; over plain HTTP the page offers no
  push and still shows the page alert.

**Docs:** `PLAN.md` section 3, `DESIGN.md` (the player page), `PLAYTEST.md`.

## M7 Setup wizard

Tasks:

- The three-step setup and "More options".
- The time estimate and the too-long warning.

Acceptance checks:

- An event can be created and started with three choices and no typing beyond its name.

**Docs:** `PLAN.md` sections 5 and 6, `DESIGN.md`.

## M8 Name tags

Tasks:

- Event graphic upload.
- The print layout and label size presets.

Acceptance checks:

- A Playwright test prints each preset to PDF; the pages are rasterized and checked by eye
  (the MEPN lesson: an export isn't verified until its pages are opened).

**Docs:** `PLAN.md` section 7, `DESIGN.md`, `PLAYTEST.md`.

## M9 Packaging

Tasks:

- The portable bundle for Windows x64 and Linux x64, built in CI and attached to releases.
- The launcher: starts the server, opens the host screen.
- Online mode settings, the reverse proxy and client IP rule, and `docs/SELF-HOSTING.md`.

Acceptance checks:

- The bundle runs on a clean Windows and a clean Fedora machine with no internet.
- A check like Pattern Break's `check:offline`: the built app makes no request off the
  local network.

**Docs:** `docs/SELF-HOSTING.md` (new), `PLAN.md` section 8, `PLAYTEST.md`.

## M10 Player stats

Tasks:

- Each handle's results across events, and a returning player's welcome on Sign-up.
- Seeding by past results.

Acceptance checks:

- A handle's stats match its recorded results across two test events.

**Docs:** `PLAN.md` section 4.

---

## Later

- **Teams:** 2 vs 2 for Smash.
- **Swiss and pools:** Swiss rounds, and pools that feed a bracket.
- **Season standings:** points across a series of events.
- **Public results page:** a read-only event page when hosted online.

## Open decisions

These need Brad's answer before the work that depends on them. Don't guess.

- **Heat tie-breaks** (M5): best single finish, then a tie-break race? Or shared place?
- **Default points table** (M5): 4, 3, 2, 1 is the plan's starting point.
- **Late sign-up** (M4, M5), Brad's son's question (2026-11-13): can players join after the
  event starts, and until when? Proposal: a bracket holds its first-round byes open for late
  players until the first round is finished (then sign-up closes for it); heats take late
  players into the next round with no points until the final.
