# Roadmap

*Last updated: 2026-11-15*

## At a glance

What comes next for ColiseumGrid, in build order. The first event is on July 10, 2027;
everything through M10 is meant to be done and play-tested before then. Finished items leave
this page and are recorded in the [changelog](CHANGELOG.md). The design behind every item is
in [`PLAN.md`](PLAN.md).

| Item | What it delivers | Stage |
|---|---|---|
| [M6 Player view](#m6-player-view) | Players follow their own matches and standings on their phones, with an alert when they're up next. | Next |
| [M8 Name tags](#m8-name-tags) | Event graphics and printed name tags. | Next |
| [M9 Packaging](#m9-packaging) | The offline bundle for Windows and Fedora, and the Docker image for online use. | Planned |
| [M10 Player stats](#m10-player-stats) | Each handle's results across events. | Planned |
| [Later](#later) | Teams, Swiss, pools, season standings, and a public results page. | Later |

**Stages:** *Next* is being worked on or starts as soon as the current item is finished.
*Planned* is settled and waiting its turn. *Later* has no plan of its own yet.

Each milestone is finished only when its acceptance checks pass. Work them in order; don't
start the next until the current one is done.

---

## M6 Player view

A player follows their own matches on their own phone, so the host spends less time waiting
for players at the concession stand or the bathroom (Brad, 2026-11-13). Design: `PLAN.md`
section 3, "Player view" and "Phone API", approved 2026-11-14.

Tasks:

- **Core.** `playerStatus` (now, next, two away, later, waiting, out, done), `alertLevel`,
  `newAlert`, and the phone API types.
- **Phone sign-in.** A phone gets its own table and the `cg_phone` cookie, not a device
  role. Handle and PIN sign-in on a new route, sharing one PIN check and its limits with the
  claim route (`CLAUDE.md`, rule 7). Limited in both modes. Phones only lock phones: wrong
  PINs on the claim route also count toward a handle's phone lock, but phone failures never
  lock the claim route (`PLAN.md`, "Player view").
- **The QR code** on the Sign-up done screen (now 30 seconds), made only after the PIN was
  set or proven. It follows the pairing code rules: works once, expires after 10 minutes,
  rate limited.
- **Several handles.** One phone follows up to 6 players, and can follow another from the
  page.
- **`GET /api/phone`** gives the followed players' status and the full standings, and no
  route a phone can reach shows a roster (`CLAUDE.md`, rule 1). A cached current answer,
  dropped on every change, keeps 30 phones from rebuilding a round robin each.
- **Live.** Phones connect to M3's connection and reload on each broadcast. A PIN reset
  removes that player from every phone following them, and signs out a phone left
  following nobody.
- **The player page** (`/follow`): the next match or group, how many are ahead, the station,
  and the standings.
- **Alerts.** A full-screen flashing alert when called to a station, a banner when next, and
  text at two away. The page title changes, a sound plays (unlocked by a first tap), and
  the phone vibrates where the browser supports it.
- **Over HTTPS only:** Web Push through a service worker, sent by the server on `node:crypto`
  with VAPID keys kept in the data folder, to an allow-list of push service hosts. iPhone and
  iPad need a Home Screen web app (iOS 16.4 and later). The page also holds a screen wake
  lock. Offline over plain HTTP, the page alert is the only alert, and the page offers no
  push.

Acceptance checks:

- A phone signs in by handle and PIN, and by the QR code; a used or expired code is refused.
- When a followed player's match is two away, the page shows it within a second of the host
  recording the result before it, for a bracket and for groups.
- Over HTTPS, a subscribed phone gets a push notification; over plain HTTP the page offers no
  push and still shows the page alert.
- The push sender's encryption matches the RFC 8291 Appendix A test values, and its VAPID
  token verifies.
- A phone is refused every host, sign-up, bracket, groups, and players route, and every new
  answer lists its fields.

**Docs:** `PLAN.md` section 3, `DESIGN.md` (the player page), `DEVELOPMENT.md`,
`PLAYTEST.md`.

M6 stays open after the code lands, until Brad's play-test over HTTPS on a real phone. Any
firewall or DNS change that test needs is Brad's to approve first (`PLAN.md`, "HTTPS on a
venue network"). Open item for the play-test: the push service hosts for Firefox and Google
are unverified (`PLAN.md`, "Player view").

## M8 Name tags

Printed name tags from the host laptop, and an event graphic on the tags and the TV (Brad,
2026-11-15). Design: `PLAN.md` section 7, `DESIGN.md` "Name tags".

Tasks:

- **Core.** The label presets and the tag's safe edge; `imageInfo`, which reads the type,
  width, and height from a PNG, JPEG, or WebP header and refuses anything else, pure and
  tested against real files of each kind (lossy, lossless, and extended WebP; baseline and
  progressive JPEG); the new fields and the `tags` message in `api.ts`.
- **Server.** Migration 9 (the event's graphic, and the `tag_queue` table with its plain PIN);
  the graphic routes, with a raw body limited to 2 MB, files under random names in
  `DATA_DIR/graphics`, a replaced file deleted once no event uses it, and the serving headers;
  queuing a tag on sign-up, claim, host add, and PIN reset; the tags routes; the 12-hour PIN
  wipe at startup and hourly; a new event keeping the graphic and emptying the queue.
- **Client.** The Name tags panel, **Print tag** on each player, the print page with its
  `@page` size and the quarter turn, the handle sized to fit, the "Did all 5 tags print?"
  dialog, the test tag, and the graphic on the Display screen.
- **Review.** A review of the whole milestone, security first (the upload and the plain
  PINs), against `PLAN.md` and `DESIGN.md`.
- **Docs finish.** `DEVELOPMENT.md` (layout, migration 9, tests), `PLAYTEST.md`, and the
  changelog entry once Brad has checked the milestone.

Acceptance checks:

- A Playwright test prints the tags for each preset, the test tag, and a 16-character handle
  to PDF against a production build. Each page's size matches the preset within 0.5 mm. The
  pages are turned into images with `pdftoppm` and looked at by the agent (the MEPN lesson: an
  export isn't verified until its pages are opened).
- A sign-up, a claim, a host add, and a PIN reset each queue a tag with the right PIN. After
  **Yes**, the PIN is gone from the database file itself, not only from the answer. A PIN
  stored 12 hours ago is wiped and its tag stays queued. A reprint has no PIN. A new event
  empties the queue.
- The upload takes a PNG, a baseline and a progressive JPEG, and lossy, lossless, and
  extended WebP files. It refuses an SVG, a file whose bytes don't match its `Content-Type`, a
  cut-off header, a file over 2 MB (413), and sizes of 0, 15, and 4001 pixels. The graphic is
  served with `nosniff` and the sandbox policy.
- A phone, a Sign-up device, and a signed-out caller are refused the tags routes and the
  graphic upload. A phone is refused the graphic too. Every new answer lists its fields and
  every new body has a closed schema.
- Screenshots of the Name tags panel and the TV with a graphic at 1366x768, 1024x768,
  768x1024, 412 wide, and 320 wide, in light and dark, looked at by the agent.

**Docs:** `PLAN.md` section 7, `DESIGN.md`, `DEVELOPMENT.md`, `PLAYTEST.md`.

## M9 Packaging

Tasks:

- The portable bundle for Windows x64 and Linux x64, built in CI and attached to releases.
- The launcher: starts the server, opens the host screen.
- The join address on the laptop. The launcher opens the host screen at `localhost`, which
  a TV can't use, so for now the pairing panel asks the host to type the laptop's address.
  The server tells the host screen its network address instead.
- Host sign-out in a shared browser. When the host signs out, the server closes every live
  connection of that session, so a player page or a paired screen open in the same browser
  loses its connection too. Like a phone sign-out since M6, it takes away only the host
  identity and leaves the connection open for the others (`endSession` in
  `packages/server/src/live.ts`).
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
- Merging a player who is in a past event's bracket. Past events become real data in M7,
  and the merge guard (409 `in-bracket`) checks only the current event, so a merge could
  break an old bracket's answer. Settle how a merge treats past events first.
- Forfeits and missing players are stored with their results from M7. How a handle's stats
  count them is not decided.

Acceptance checks:

- A handle's stats match its recorded results across two test events.

**Docs:** `PLAN.md` section 4.

---

## Later

- **Teams:** 2 vs 2 for fighting games.
- **Swiss and pools:** Swiss rounds, and pools that feed a bracket.
- **Season standings:** points across a series of events.
- **Public results page:** a read-only event page when hosted online.
- **Badge sheets:** name tags on 8-per-page badge sheets for an ordinary printer, with a
  nudge setting to line them up (Brad chose a thermal printer first, 2026-11-15).

## Open decisions

These need Brad's answer before the work that depends on them. Don't guess.

None open. The default points table, 4, 3, 2, 1, was decided by Brad on 2026-11-13 (`PLAN.md`,
"Races and free-for-all").
