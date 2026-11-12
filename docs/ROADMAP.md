# Roadmap

*Last updated: 2026-11-12*

## At a glance

What comes next for ColiseumGrid, in build order. The first event is on July 10, 2027;
everything through M9 is meant to be done and play-tested before then. Finished items leave
this page and are recorded in the [changelog](CHANGELOG.md). The design behind every item is
in [`PLAN.md`](PLAN.md).

| Item | What it delivers | Stage |
|---|---|---|
| [M1 Workspace and checks](#m1-workspace-and-checks) | The pnpm workspace, lint, type-check, tests, CI, dependency audits, and an image build. | Next |
| [M2 Players and sign-up](#m2-players-and-sign-up) | Handles, the vulgarity filter, PINs, and the Sign-up screen. | Planned |
| [M3 Pairing and live screens](#m3-pairing-and-live-screens) | Join codes, QR codes, device roles, live updates, and the Display screen's frame. | Planned |
| [M4 1 vs 1 brackets](#m4-1-vs-1-brackets) | Single and double elimination, round robin, stations, the queue, and undo. | Planned |
| [M5 Races and free-for-all](#m5-races-and-free-for-all) | Heats with placement points, rounds, and a final. | Planned |
| [M6 Setup wizard](#m6-setup-wizard) | The three-step setup and the time estimate. | Planned |
| [M7 Name tags](#m7-name-tags) | Event graphics and printed name tags. | Planned |
| [M8 Packaging](#m8-packaging) | The offline bundle for Windows and Fedora, and the Docker image for online use. | Planned |
| [M9 Player stats](#m9-player-stats) | Each handle's results across events. | Planned |
| [Later](#later) | Teams, Swiss, pools, season standings, and a public results page. | Later |

**Stages:** *Next* is being worked on or starts as soon as the current item is finished.
*Planned* is settled and waiting its turn. *Later* has no plan of its own yet.

Each milestone is finished only when its acceptance checks pass. Work them in order; don't
start the next until the current one is done.

---

## M1 Workspace and checks

Tasks:

- pnpm workspace with `packages/core`, `packages/server`, and `packages/client`, using the
  versions in `PLAN.md` section 9 (recheck them first).
- `pnpm check`: Oxlint, type-check, Vitest, and the docs check.
- CI runs `pnpm check`, `pnpm build`, and `pnpm audit --audit-level high`.
- Dependabot for npm and GitHub Actions.
- `Dockerfile` and the `docker.yml` workflow, following Pattern Break's, publishing
  `ghcr.io/bradbrownjr/coliseumgrid:edge` from the default branch.
- The server serves the built client and answers `GET /api/health`.
- Pick the QR code library (see `PLAN.md` section 9).

Acceptance checks:

- `pnpm check` and `pnpm build` pass locally and in CI.
- CI fails when `pnpm audit` finds a high or critical advisory.
- `docker run` on the image serves the client and `/api/health`.

**Docs:** `DEVELOPMENT.md` (requirements, commands, layout), `PLAN.md` section 9.

## M2 Players and sign-up

Tasks:

- Handle rules and the vulgarity filter in `packages/core`, ported from Pattern Break's
  `name.ts` with its innocent-name tests (see `PLAN.md` section 4).
- PIN suggestion, hashing, and checking.
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
- Host sign-in for both modes.
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

## M6 Setup wizard

Tasks:

- The three-step setup and "More options".
- The time estimate and the too-long warning.

Acceptance checks:

- An event can be created and started with three choices and no typing beyond its name.

**Docs:** `PLAN.md` sections 5 and 6, `DESIGN.md`.

## M7 Name tags

Tasks:

- Event graphic upload.
- The print layout and label size presets.

Acceptance checks:

- A Playwright test prints each preset to PDF; the pages are rasterized and checked by eye
  (the MEPN lesson: an export isn't verified until its pages are opened).

**Docs:** `PLAN.md` section 7, `DESIGN.md`, `PLAYTEST.md`.

## M8 Packaging

Tasks:

- The portable bundle for Windows x64 and Linux x64, built in CI and attached to releases.
- The launcher: starts the server, opens the host screen.
- Online mode settings, the reverse proxy and client IP rule, and `docs/SELF-HOSTING.md`.

Acceptance checks:

- The bundle runs on a clean Windows and a clean Fedora machine with no internet.
- A check like Pattern Break's `check:offline`: the built app makes no request off the
  local network.

**Docs:** `docs/SELF-HOSTING.md` (new), `PLAN.md` section 8, `PLAYTEST.md`.

## M9 Player stats

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
- **Handle length** (M2): 2 to 16 characters is the plan's starting point.
- **Default points table** (M5): 4, 3, 2, 1 is the plan's starting point.
