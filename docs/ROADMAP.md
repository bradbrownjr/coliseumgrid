# Roadmap

*Last updated: 2026-11-13*

## At a glance

What comes next for ColiseumGrid, in build order. The first event is on July 10, 2027;
everything through M10 is meant to be done and play-tested before then. Finished items leave
this page and are recorded in the [changelog](CHANGELOG.md). The design behind every item is
in [`PLAN.md`](PLAN.md).

| Item | What it delivers | Stage |
|---|---|---|
| [M5 Races and free-for-all](#m5-races-and-free-for-all) | Heats with placement points, rounds, and a final. | Next |
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

## M5 Races and free-for-all

Heats with placement points, qualifying rounds, and a final. On screen a heat is a "Group".
Design: `PLAN.md`, "Races and free-for-all" and "Heats API".

Tasks:

- Heats in `packages/core/src/heats.ts`: group sizes, round 1 from the seeding, regrouping
  by points for later rounds, the points table (editable, default 4, 3, 2, 1), standings by
  points, the cut for the final and its tie-break heats, the final's places, and where a late
  player goes. The shared API types in `api.ts`. `QueueMatch.players` takes up to 4 players.
- `heat-engine.ts` in `packages/server`: replay of the log, late joins, undo, and tie-breaks,
  on the M4 pattern.
- Migration 5, `heat-store.ts`, the `/api/heats` routes and their schemas, one competition
  per event on the shared write chain, and the merge guard over both stores.
- Recording a heat by tapping players in finishing order, once per heat; races per heat is a
  label. Undo.
- Late sign-up: a late player joins the smallest round 1 heat still waiting with room, until
  round 1 is finished (`PLAN.md`, "Late sign-up").
- The host's start dialog and heats section, and heat standings on the Display screen with
  the line for the final.

Acceptance checks:

- Tests run every player count from 2 to 32 to a finished final, with 1 to 8 stations and 1
  to 3 rounds: places 1 to 3 are unique, and every player plays the same number of qualifying
  heats.
- Group sizes for every count from 2 to 32 add up to the count, are 2 to 4, and differ by at
  most 1.
- A late player plays the same number of heats as everyone else, and no heat already run or
  called changes. A late join is refused when no round 1 heat is waiting with room, or round 1
  is finished.
- Ties are settled by the rule in `PLAN.md`, "Ties": one tie-break race among the players
  level across the cut for the final, played again for whoever is still level. Ties of 2, 4,
  and 6 players settle.
- Undo follows the M4 rules: undoing the newest result restores the answer exactly, and an
  older undo moves no heat on a station or is refused with `undo-later-first`.
- One competition per event: heats can't start while a bracket is running, or a bracket while
  heats are running. A player in heats can't be merged away.
- `bracket-undo-fuzz.test.ts` and the other M4 tests still pass.

**Docs:** `PLAN.md` section 5 and "Heats API", `DEVELOPMENT.md` ("Heats"), `DESIGN.md`,
`DOC-STYLE.md`, `PLAYTEST.md`.

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
- The join address on the laptop. The launcher opens the host screen at `localhost`, which
  a TV can't use, so for now the pairing panel asks the host to type the laptop's address.
  The server tells the host screen its network address instead.
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

None open. The default points table, 4, 3, 2, 1, was decided by Brad on 2026-11-13 (`PLAN.md`,
"Races and free-for-all").
