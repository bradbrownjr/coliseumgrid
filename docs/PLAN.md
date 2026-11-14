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
| Player's phone | Player view | Follows one or more handles: their next match, how far away it is, the station, and standings, with an alert when they're up (from M6) |

One console is the starting point, with room for a second. Each console is a **station**,
and the queue sends the next match to the first free station.

### Player view

Planned for M6 (Brad, 2026-11-13). A player signs in on their own phone with handle and PIN,
or by scanning a QR code on the Sign-up done screen, and follows their matches. One phone can
follow several handles. The phone has to reach the server: at an offline venue it joins the
event Wi-Fi; a phone on cellular data can't reach the laptop.

Alerts depend on HTTPS, because browsers only give these features to a secure context, and a
plain `http://192.168.x.x` address isn't one; only `localhost` is
(<https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts>):

| | Offline, plain HTTP | Online, HTTPS |
|---|---|---|
| Page alert (banner, title, sound after a first tap) | Yes | Yes |
| Vibration | Android only (<https://caniuse.com/vibration>) | Android only |
| Screen wake lock | No | Yes (<https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API>) |
| Push notifications | No | Yes; on iPhone and iPad only from a Home Screen web app, iOS 16.4 and later (<https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>) |

Push also goes through the browser maker's push service (Apple's for iOS), so it needs the
internet (<https://www.w3.org/TR/push-api/>). Offline, the page alert works only while the
page is open and the screen is on. Whether a page's sound keeps playing on a locked phone is
undocumented; WebKit bug reports say iOS stops it
(<https://bugs.webkit.org/show_bug.cgi?id=173332>). On Android there is one first-hand
report: Pattern Break's jukebox keeps playing with the screen locked on a Samsung Galaxy S25
(Brad, 2026-11-13). That is sound already playing; an alert has to start a sound later,
which is still untested. `PLAYTEST.md` tests both on real phones before anything relies on
it.

An option not yet planned: a real certificate for a hostname that points at the laptop on
the venue network would make the page a secure context offline, which allows the wake lock
(push would still need the internet).

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
- **Setting the password** (Brad, 2026-11-13): the `COLISEUMGRID_HOST_PASSWORD` environment
  variable sets it, masked in the Unraid template; the Docker image and online mode need
  it. Offline, the laptop can instead set it on first run from `localhost`, so no other
  device on the network can claim the host. It is stored hashed, like PINs.
- **Sign-up devices** (Brad, 2026-11-13): from M3, only a paired Sign-up device can create
  players or claim a handle. M6's player phones get their own sign-in.
- **The event name** (Brad, 2026-11-13): in M3 the host types the current event's name for
  the Display frame. The M7 setup wizard takes this over.

### Devices and host API

Planned in M3 (2026-11-13). The rules of the players API apply: bodies are JSON, every
answer lists its fields, errors are `{ "error": code }`.

**Sessions.** The host has a session cookie, `cg_host`; a paired device has `cg_device`.
Both are random tokens stored hashed on the server, `HttpOnly` and `SameSite=Strict`, and
`Secure` when the request came over HTTPS. Separate cookies let one laptop browser be the
host and a display at once. A host session lasts 12 hours; a device token lasts until the
host unpairs it.

| Request | Who | Answer |
|---|---|---|
| `GET /api/host/session` | anyone | `{ signedIn, passwordSet, canSetUp }`; `canSetUp` is true only offline, from `localhost`, with no password yet |
| `POST /api/host/setup` `{ password }` | offline `localhost`, no password yet | 204 and a session; otherwise 403 `{ error: "forbidden" }` |
| `POST /api/host/sign-in` `{ password }` | anyone | 204 and a session; 401 `wrong-password`; 429 `too-many-tries` |
| `POST /api/host/sign-out` | host | 204 |
| `POST /api/pairing/codes` `{ role }` | host | 201 `{ code, role, expiresAt }`; `role` is `"display"` or `"signup"` |
| `POST /api/devices/join` `{ code }` | anyone | 201 `{ device }` and the device cookie; 404 `wrong-code` for unknown, used, or expired; 429 `too-many-tries` |
| `GET /api/devices/me` | device | `{ device }`; 401 `not-paired` |
| `GET /api/devices` | host | `{ devices: [device] }` |
| `DELETE /api/devices/:id` | host | 204; the device's token stops working and its live connection closes |
| `GET /api/event` | host or device | `{ event }`, or `{ event: null }` before one is named |
| `PUT /api/event` `{ name }` | host | `{ event }` |
| `GET /api/live` (WebSocket) | host or device | messages from the server, below |

A device leaves the server as `{ id, role, label, lastSeen }`, where `label` is a short name
the server gives it ("Display 1", "Sign-up 2"). An event is `{ name }` for now.

The host picks the role when making a code, so a TV only has to type the code. The host
password itself is never sent back. Wrong codes and wrong passwords are rate limited per
client IP in both modes (`CLAUDE.md`, rule 7), with the IP taken by rule 6. An IPv6 client
counts by its /64, so a caller can't get fresh tries by changing the end of its address.
Wrong codes are also capped across all callers (100 per 10 minutes), so a guesser with many
addresses can't search the code space; once the cap is used up, every join answers 429 until
the window ends.

**Origin.** `SameSite=Strict` doesn't stop a page on another port of the same address, or on
a sibling subdomain. So any request that isn't a `GET`, `HEAD`, or `OPTIONS`, and the
`GET /api/live` handshake, is refused with 403 `{ "error": "forbidden" }` when it carries an
`Origin` header whose host and port differ from the `Host` header (an `Origin` of `null` or
one that isn't a URL counts as different). A request with no `Origin` comes from a tool, not
a page, and passes. The reverse proxy has to pass `Host` through unchanged.

**Password changes.** Sessions outlive a restart. When `COLISEUMGRID_HOST_PASSWORD` names a
different password than the stored one, the server stores the new one and ends every host
session at startup. Paired devices stay paired.

From M3, the M2 host routes need a host session (offline `localhost` signs in without the
password), and the sign-up routes need a Sign-up device or a host session. Without one, a
route answers 401 `{ error: "not-signed-in" }`.

**Live messages** are JSON with a `type`: `{ type: "event", event }` when the event changes,
`{ type: "players" }` when the player list changes (the host page reloads it), and
`{ type: "unpaired" }` just before the server closes an unpaired device's connection. A
client reconnects with a growing delay after a drop.

**The Display frame** in M3 shows the event name, live. "Up next" and the match timer have
their places on the screen but show a waiting message until M4 brings matches.

## 4. Players

### Handles

- 2 to 16 characters (Brad, 2026-11-12): letters, digits, spaces, and `. - _`. Shown as typed, compared
  without regard to case, so `Zap` and `ZAP` are the same player.
- The vulgarity filter is a port of Pattern Break's `packages/core/src/name.ts`: roots that
  count anywhere in a handle, roots that count only as a whole word (to avoid blocking
  innocent words like "class"), and two readings of each handle (look-alike digits read as
  letters, and runs of single letters joined, so `A.S.S` fails). Its tests of innocent names
  come with it. The port changes it for mixed case and the longer length, and tightens it
  (Brad, 2026-11-12): a third reading splits the handle at capital letters, so `BigAss`
  reads as "Big Ass" and fails, and the lists gain common spelled-by-sound variants. The
  cost is that `PeaCock` fails while `Peacock` passes.
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

### Players API

Planned in M2 (2026-11-12). Bodies are JSON. Every response lists its fields; a player
leaves the server as `{ "id": number, "handle": string }` and nothing more (`CLAUDE.md`,
rule 1). Errors are `{ "error": code }`, plus `"reason"` for a refused handle. The
client turns codes into words; the server never sends sentences. Any route can also answer
`{ "error": "not-found" }` for an unknown path and 500 `{ "error": "server-error" }` for a
fault.

Sign-up (tablet):

| Request | Answer |
|---|---|
| `POST /api/signup/check` `{ handle }` | `{ status: "available", handle, suggestedPin }`, or `{ status: "taken", handle }`, or 400 `{ error: "refused", reason }` |
| `POST /api/signup` `{ handle, pin }` | 201 `{ player }`; 409 `{ error: "taken" }`; 400 `{ error: "refused", reason }` or `{ error: "bad-pin" }` |
| `POST /api/signup/claim` `{ handle, pin }` | `{ player }`; 401 `{ error: "wrong-pin" }`; 404 `{ error: "not-found" }`; 429 `{ error: "too-many-tries" }` |

`handle` in an answer is the normalized display form from `packages/core`. The server runs
the handle check on every request that takes a handle, whatever the client checked (rule
2). `suggestedPin` comes from the server's random source, so the tablet needs no state.

Host (laptop):

| Request | Answer |
|---|---|
| `GET /api/players` | `{ players: [player] }`, sorted by handle |
| `POST /api/players` `{ handle }` | 201 `{ player, pin }`, with a suggested PIN for the host to read out |
| `PATCH /api/players/:id` `{ handle }` | `{ player }`; 409 `{ error: "taken" }`; 400 refused; 404 |
| `POST /api/players/:id/merge` `{ intoId }` | `{ player }` (the one kept); the merged player is deleted; 404 |
| `POST /api/players/:id/reset-pin` | `{ pin }`, a new suggested PIN, shown once |

The host requests need a host session (offline, `localhost` counts as one), and the sign-up
requests need a Sign-up device or a host session ("Devices and host API"). Without one, a
route answers 401 `{ "error": "not-signed-in" }`.

PIN attempts on `/api/signup/claim` are rate limited per handle and per client IP in online mode, with the
client IP taken by rule 6. Offline, a wrong PIN only costs a retry.

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

Three formats, all run by `brackets-manager`. Checked against version 1.11.1 on 2026-11-13.

| On screen | Format | Players | Results to a finish |
|---|---|---|---|
| One life | Single elimination, with a 3rd-place match | 2 to 32 | n - 1, plus 1 for the 3rd-place match from 4 players |
| Two lives | Double elimination: out after a second loss | 3 to 32 | 2n - 2, or 2n - 1 when the rematch for the title is played |
| Everyone plays everyone | Round robin, one group | 2 to 32 | n(n - 1) / 2 |

- **Two lives needs 3 players.** With 2 the library makes one match and no final
  (`isDoubleEliminationNecessary` in its `helpers.js`), and `finalStandings` then throws.
- **Best of 1, 3, or 5 is a label** on the host screen and the TV. The host taps the winner
  of the whole match, one tap per match. The library can record each game of a match
  (`matchesChildCount`); we don't use it.
- **Seeding is random.** `packages/core` shuffles the player ids with the caller's random
  source and pads the list with empty slots at the end, up to a power of two for
  elimination and an even count for a round robin. The library gives the first spots the
  byes, so byes go to the top seeds of the shuffle and two byes never meet. The library has
  no randomness of its own. On screen a bye reads "Moves on this round" (see `DOC-STYLE.md`,
  "Tournament words on screen"). Seeding by past results is M10.
- **Single elimination has a 3rd-place match**, between the two semi-final losers, so 3rd is
  decided by play. It is the library's `consolationFinal` setting, which needs a bracket of
  4 or more slots. Checked 2026-11-13: sizes 3 to 32 run to a finish with it; with 2 players
  the library throws, so there is only the final. With 3 players the semi-final bye leaves
  the other semi-final's loser in 3rd without a match.
- **Two lives** has unique places 1 to 3 already: the 3rd place is the player knocked out in
  the losers' final. The library is set to `grandFinal: 'double'`, so the rematch for the
  title is played only when the player coming from the losers' side wins the first final
  (brackets-model, `input.d.ts`).
- **Stations are 1 to 8**, picked at creation and fixed for that bracket (see "Stations and
  the queue").
- **Everyone plays everyone** is one group in the library's `simple` mode. An odd number of
  players gets an empty slot, so one player sits out each round. It ranks by wins; see
  "Ties". With 32 players it is 496 matches.

### Races and free-for-all

Planned in M5 (2026-11-13). The same format runs Mario Kart races and 4-player Smash
free-for-alls: a **heat** is a group of 2 to 4 players who play together on one station, and
each finishing place earns points. On screen a heat is a "Group" (Brad, 2026-11-13), because
Smash has no races. For the same reason the setting reads "Games in each group" on screen
(a game is a race or a match), and a tie-break heat is a "Tie-break group". The format's name,
"Races and free-for-all", stays. The rules are in `packages/core/src/heats.ts`.

| Setting | Range | Default |
|---|---|---|
| Stations | 1 to 8 | |
| Races per heat | 1 to 4 | |
| Rounds before the final | 1 to 3 | 2 |
| Points for 1st to 4th | Whole numbers 0 to 20, never rising, 1st at least 1 | 4, 3, 2, 1 |

- **Group sizes.** `n` players make `ceil(n / 4)` heats, as even as possible, larger heats
  first: 5 is 3 + 2, 6 is 3 + 3, 7 is 4 + 3, 9 is 3 + 3 + 3, 10 is 4 + 3 + 3. There is never a
  heat of 1, and a heat of 2 only at 2 and 5 players. The UT Austin Mario Kart 8 Deluxe
  tournament FAQ splits players "into groups as evenly numbered as possible"
  (<https://universityunions.utexas.edu/sites/default/files/Mario%20Kart%20Tourney%20FAQ.pdf>),
  and the Delaware DSEL Mario Kart 8 rules put 4 players on each Switch
  (<https://education.delaware.gov/wp-content/uploads/2025/09/dsel_mario_kart_8_rules.pdf>).
- **2 to 4 players** play no qualifying rounds. The one heat is the final.
- **Round 1** is the seeding, a shuffle with the caller's random source (the same
  Fisher-Yates shuffle as a bracket), cut into heats in order. SMASH! Kart Grand Prix 2025
  shuffles its 32 racers into groups the same way
  (<https://2025.smash.org.au/whats-on/competitions/gaming-competitions/smash-kart-grand-prix>).
- **Later rounds** regroup the players by points so far, cut into heats in that order, with
  players level on points kept in seeding order, so no new randomness is used. The larger
  heats take the top of the order: a heat of 3 averages more points per player than a heat of
  4, so that edge goes to the players furthest from the cut. A round is made when every heat
  of the round before has a result. This is our rule, modeled on the Swiss system, where each
  round pairs players with "the same or similar score", "the number of rounds is fixed in
  advance", and nobody is knocked out
  (<https://en.wikipedia.org/wiki/Swiss-system_tournament>). No event we found regroups by
  points between rounds; the ones found shuffle once, then cut.
- **Points** come from the one table by finishing place, in every heat: a heat of 3 scores
  places 1 to 3, and a heat of 2 places 1 and 2 (Brad, 2026-11-13). The host can edit the table
  for each event. The Delaware DSEL rules add up points by place over a cup
  (15, 12, 10, and down to 1); 4, 3, 2, 1 is the same idea sized for heats of 4. The table is
  checked by `isPointsTable`: 1st has to score at least 1, so winning a heat always counts.
- **Recording** is once per heat (Brad, 2026-11-13): the host taps the players in finishing
  order from the game's results screen after the cup. **Races per heat ("Games in each group" on screen) is a label**, like
  best of in a bracket. Entering every race would be 16 taps a heat.
- **Fairness.** Everyone plays the same number of qualifying heats, `rounds`, before the
  final, late players included (see "Late sign-up"). Tie-break heats score nothing.
- **The final.** The top 4 by points play one more heat, the final, and its finishing order
  alone gives places 1 to 4 (Brad, 2026-11-13), so places 1 to 3 can't tie. The SMASH! Grand
  Prix also starts its final fresh. Places 5 and down are by qualifying points, shared when
  level, after any tie-break at the cut. The Nintendo Live 2023 Mario Kart 8 Deluxe qualifier
  also sends the top of each group's leaderboard on and gives no points table or tie rule
  (<https://nintendo.com/nintendo-live/tournaments/mario-kart-8-deluxe-championship-2023-qualifier>).
- **Stations.** Heats go on stations through the same queue as bracket matches (see
  "Stations and the queue"): one heat per station, and a heat waits while any of its players
  is on another station. Stations sit idle at the end of a round, because the next round waits
  for every result.
- **Undo** works as in a bracket. Undoing the newest result takes it out of the log. An older
  undo reopens its heat at a new step and moves nothing on a station; it is refused (409
  `undo-later-first`) when a later round, a tie-break, or the final was made from it. The heats
  of one round don't depend on each other, so an older undo works within a round.

With 32 players and 2 rounds there are 16 qualifying heats, then any tie-breaks and the
final. The 4, 3, 2, 1 table gives many ties, so the cut often needs a tie-break heat.

### Ties

Brad, 2026-11-13: prizes can't be split, so **places 1 to 3 are never shared**. A tie that
touches them is played off. Ties further down the order are shared (two players both 5th).

**Elimination.** Play decides every place from 1 to 3. Single elimination has the 3rd-place
match; two lives has unique places by its structure (see "1 vs 1 bracket"). Other places
are shared by the round in which a player went out.

**Round robin.** Order by wins. For players level on wins:

1. **Two players:** the winner of the match between them ranks higher.
2. **Three or more:** count wins only in the matches among the tied players, and order by
   that. Apply the same step again to whoever is still level.
3. **Still level** (a loop such as A beat B, B beat C, C beat A, or everyone level): if the
   tie touches places 1 to 3, the tied players play a **tie-break round**. It is a round
   robin among only those players, each match best of 1. A tie-break round that leaves some
   players level is played again among only those players, until each podium place has one
   player. A group still level below 3rd is shared.

A complete round robin always separates a two-way tie, because the two played each other, so
a shared place comes only from a loop of three or more below 3rd. Before every match has a
result, the order is provisional and no tie-break is asked for.

The host sees "Tie for 1st: Zap and Kai" and a "Play tie-break" button. The tie-break
matches go on stations like any match, and are recorded and undone like any result. They
are the server's own matches (side `tie-break`), not the library's. The rules are in
`packages/core/src/ties.ts`.

**Heats (M5).** Ties are played off only at the cut for the final. After the last
qualifying round, players level on points who straddle 4th and 5th are listed in `ties`, and
"Play tie-break" makes one tie-break heat among only them; its finishing order settles their
order. More than 4 tied are split into heats by the group sizes rule and ordered by place in
their tie-break heat (the 1st places level with each other, then the 2nd places), and whoever
is still level across the cut plays again. Each pass leaves at most one player from each heat
in a level, so it ends. The order a tie-break sets stands below the cut too. Other ties are
shared. The final's own finishing order sets places 1 to 4, so places 1 to 3 never tie. The
SMASH! Kart Grand Prix 2025 settles a draw for the last advancing spot with one Sudden Death
race
(<https://2025.smash.org.au/whats-on/competitions/gaming-competitions/smash-kart-grand-prix>).

The practice behind these rules, from published rules (checked 2026-11-13, except FIDE,
whose page was unreachable that day and is cited from the earlier research):

- PlayVS scholastic Mario Kart 8 Deluxe rulebook, section 1.7: when two teams are level at
  the end of a game, "an additional one (1) race will be set up" and the team with more
  points in it wins
  (<http://help.playvs.com/en/articles/5872507-playvs-scholastic-mario-kart-8-deluxe-rulebook>).
  This is the model for the heat tie-break.
- SmashWiki, "Round Robin": a round robin may have no clear winner, and one way to settle it
  is to have the top two play one more set
  (<https://www.ssbwiki.com/Round_Robin>). This is the model for the tie-break round.
- FIFA 2026 World Cup group stage, via NBC Sports: the first tie-break between teams level on
  points is the head-to-head match
  (<https://www.nbcsports.com/soccer/news/what-are-the-new-group-stage-tiebreaker-rules-at-the-2026-world-cup>).
  The article doesn't say whether it is applied again to the teams still level; applying it
  again among only the tied players is our rule.
- FIDE tie-break regulations, "direct encounter" among tied players
  (<https://handbook.fide.com/chapter/TieBreakRegulations2023>).

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

### Late sign-up

Brad, 2026-11-13, from his son's question. A player can join after the event starts, until
round 1 is finished, as long as they have someone to play and nothing already played
changes. Where a format can't take them without rebuilding, the late sign-up is refused.
On-time players are never moved or made to replay.

| Format | A late player | Closes when |
|---|---|---|
| Single and double elimination | Takes a first-round bye, and plays the player who would have moved on | No bye is left, or round 1 is finished |
| Round robin | Takes the empty slot, so the player who sat out each round now plays them. Only with an odd number of players; with an even number there is no empty slot and the sign-up is refused | The count is even, or round 1 is finished |
| Heats | Goes into the smallest round 1 heat that is still waiting (not on a station) and has fewer than 4 players, the lowest number on a tie. Later rounds are split from the new count, so a late player plays as many heats as everyone else | No such heat is left, or round 1 is finished |

**What the research found (2026-11-13).** The library's `update.seeding` can't be used.
With `keepSameSize`, filling one bye turned every other bye into an empty slot to be
decided, dropped winners already moved into round 2, and in two lives wiped a finished
loser-bracket match. Its own guard only looks at round 1 for matches that are running or
archived. The server never calls it.

**How the server does it.** A bracket is stored as its settings, a seeding list (player ids
and empty slots), and the ordered log of results (see "Brackets API"). A late join puts the
player in the first empty slot of the list, rebuilds the bracket from scratch on an
in-memory store by replaying the log, and accepts the change only if every logged result
still replays with the same two players and every match on a station keeps its two players
and its station. Otherwise the join is refused (409 `late-closed`). In a test of random play
at every size and format, 151 joins were accepted and 406 refused, and no recorded match
changed. In a round robin an odd count gains a player without changing any pairing; an even
count would redraw them.

The queue holds matches with a player who had a first-round bye until round 1 is finished,
so the byes stay open (see "Stations and the queue").

**Heats.** A late join stores the heat and the step it was made at, and changes no heat
already called. When there are as many stations as round 1 heats, every heat is called at the
start and late sign-up closes then (Brad, 2026-11-13). With 2 to 4 players the one heat is the
final, called at the start, so there is no late sign-up.

### Stations and the queue

Planned in M4 (2026-11-13). A **station** is one console. The host picks 1 to 8 when the
bracket is made, and the number is fixed for that bracket, because the assignment below is
derived from it.

Nothing about stations is stored. The server replays the log and notes the steps at which
each match was ready (step 0 is the new bracket, step k is after the k-th log entry). An
entry is a result, or an older undo (see below). `packages/core/src/queue.ts` turns that
history into the stations, so the same log gives the same stations after a restart.

- **Queue order:** the step a match became ready, then round, then match number, then its
  id. A late player's matches count as ready from the step they joined, so they queue behind
  matches already waiting.
- **Calling a match:** when a result is recorded, its station is free. Every free station,
  lowest number first, takes the first waiting match none of whose players is on another
  station. A round robin needs the check, because all its matches are ready at once. A heat
  goes through the same queue with up to 4 players (see "Races and free-for-all").
- **Bye hold-back:** while any first-round match has no result, a match with a player who
  had a first-round bye waits. The cost is that with two stations one may sit idle near the
  end of round 1.
- **`calledAt`** is the time of the result that freed the station, or the bracket's creation
  time for the first matches. The TV counts up from it. There is no alarm.
- **Up next** is the waiting matches in queue order. A match whose player is still on a
  station stays on the list and is skipped when a station is filled.
- **Undoing the newest result** takes it out of the log. The bracket is exactly what it was
  before that result, so the match its station called goes back to Up next. This is the
  snackbar's Undo, used within seconds. It always works.
- **Undoing an older result** reopens that match and moves nothing being played (decided in
  the M4 review, 2026-11-13, which found that taking the result out of the log moved matches
  between stations). The result stays in the log, marked undone at a new step, so the stations it
  freed stay as they were. Every match on a station keeps its station and `calledAt`; the
  reopened match goes to the front of Up next and takes the next free station, or an idle
  one at once. Reopened matches go in the order they were reopened. A reopened first-round
  match doesn't hold back the matches of a player who had a bye.
- **An older undo is refused** (409 `undo-later-first`) when something later depends on it:
  a later result that no longer replays with the same two players, a match on a station that
  would lose a player, or a tie-break made after it. A waiting match that loses a player
  leaves Up next until it has two players again.

### Brackets API

Planned in M4 (2026-11-13). The rules of "Devices and host API" apply: bodies are JSON,
every answer lists its fields, errors are `{ "error": code }`, and a missing session is 401
`not-signed-in`. The shared types are in `packages/core/src/api.ts`.

**Storage.** Migration 3 adds `brackets` (the event, format, best of, stations, the seeding
as a JSON list of player ids and nulls, and the creation time), `bracket_results` (the
bracket, the match, the winner, the loser, and the time), `bracket_late_joins` and
`bracket_tie_breaks` (in order, each with the step it was made at), and `event_players` (the
event and the player). An event has one bracket, and a new one replaces it. Migration 4
adds `undone_step` and `undone_at` to `bracket_results`: a result taken back by an older undo
keeps its row, with the step and time of the undo. No handle is stored; an answer joins the
current one. The server rebuilds the library's state on its
in-memory store (`brackets-memory-db`) by creating the stage and replaying the log. It checks that each logged match is ready and holds the same two players.
A tie-break match is stored by the server with the step at which it was made, and its
result goes in the same log. Replay of 32 players took 13 ms in two lives (63 results) and
258 ms in a round robin (496 results), so there is no cache in M4.

Every bracket write runs one at a time on a promise chain, because the library is
asynchronous and two taps could interleave. **Undo** of the newest result drops it from the
log and replays; in a test of 4206 undos and 4206 replays at every size and format, each
matched the live bracket exactly. An older undo adds an entry to the log instead (see
"Stations and the queue"); the replay then starts a new in-memory store at that entry and
replays the results still standing. In a test of random play with random undos (56 brackets
in all three formats, 3 to 16 players, 1 or 3 stations, 1269 steps), 209 newest undos and 78
older undos were taken and 73 older undos refused. No match on a station moved, except the
one a newest undo un-called, the stored state gave the live answer after every step, and every
bracket finished with one player in each of places 1 to 3. The library's own
`reset.matchResults` left matches in the wrong state or threw, so it isn't used.

| Request | Who | Answer |
|---|---|---|
| `GET /api/bracket` | host or device | `{ bracket }`, or `{ bracket: null }` before one is made |
| `POST /api/bracket` `{ format, bestOf, stations, playerIds }` | host | 201 `{ bracket }`; 409 `bracket-running`; 400 `too-few-players`, `too-many-players`, or `bad-request` |
| `POST /api/bracket/results` `{ matchId, winnerId }` | host | `{ bracket, resultId }`; 409 `not-on-station`; 400 `bad-request` if the winner isn't in the match; 404 `not-found` for a match that isn't there |
| `POST /api/bracket/undo` `{ resultId }` | host | `{ bracket }`; 409 `undo-later-first`, or `nothing-to-undo` for a result not in the log or already undone |
| `POST /api/bracket/players` `{ playerId }` | host | `{ bracket }`; 409 `late-closed` or `already-in`; 404 `not-found` for a player who isn't there |
| `POST /api/bracket/tie-break` | host | `{ bracket }` with the tie-break matches made; 409 `no-tie` if the bracket answer lists no tie that still needs matches |
| `DELETE /api/bracket` | host | 204; the host screen asks first, since it can't be undone |
| `GET /api/event/players` | host | `{ playerIds }`: the players signed up to the current event |

The four `POST` routes under `/api/bracket/` answer 404 `no-bracket` when the event has no
bracket. `format` is `single`, `double`, or `round_robin`; `bestOf` is 1, 3, or 5; `stations`
is 1 to 8. A new bracket replaces a finished one. A running bracket answers 409 `bracket-running`.
`playerIds` are 2 to 32 players (3 or more for `double`).

The bracket answer is:

```ts
interface Bracket {
  id: number;
  format: 'single' | 'double' | 'round_robin';
  bestOf: 1 | 3 | 5;
  finished: boolean;        // every place is decided, no tie waiting
  lateOpen: boolean;        // the host can still add a player (see "Late sign-up")
  lastResultId: number | null;  // the newest result not undone
  stations: { number: number; match: BracketMatch | null; calledAt: string | null }[];
  upNext: BracketMatch[];
  matches: BracketMatch[];
  standings: { place: number; player: Player; wins: number; losses: number }[];
  ties: { place: number; players: Player[]; started: boolean }[];
}
interface BracketMatch {
  id: number;
  side: 'main' | 'winners' | 'losers' | 'final' | 'rematch' | 'third' | 'tie-break';
  round: number;            // from 1 within a side; a tie-break's round counts tie-break rounds
  number: number;           // from 1 within a round
  status: 'waiting' | 'ready' | 'playing' | 'done' | 'bye';
  slots: [{ player: Player | null; bye: boolean }, { player: Player | null; bye: boolean }];
  winner: 0 | 1 | null;
  resultId: number | null;  // what to send to /undo
}
```

`status` is `waiting` while a player is unknown, `ready` once both are known and the match is
in the queue, `playing` on a station, `done` with a result, and `bye` when a side is empty.
A rematch for the title that is no longer needed is left out of `matches`. `ties` lists each
tie for places 1 to 3 that is not settled: "Play tie-break" makes its matches, and `started`
is true while they exist. Every field of every answer is named in a schema in
`api-schemas.ts` with `additionalProperties: false`, and an answer carries a player only as
`{ id, handle }` (`CLAUDE.md`, rule 1).

**Error codes** (the client turns each into words in `packages/client/src/api/errors.ts`):
`bracket-running`, `too-few-players`, `too-many-players`, `not-on-station`,
`undo-later-first`, `nothing-to-undo`, `late-closed`, `already-in`, `in-bracket`, `no-tie`,
and `no-bracket`.

**Live.** The server sends `{ type: "bracket" }` when the bracket changes, and screens
reload it. The Display and the host screen also reload it on `players`, for renames.

**Who is in a bracket.** Players are kept across events and attendance isn't tracked, so
`event_players` lists who signed up to the current event. Sign-up, claim, and the host's
"Add player" fill it, and the start dialog pre-checks the event's players. A player who
signs up before the host has named an event goes into one the server makes then, named
"ColiseumGrid" (what the Display shows with no event), and the host can rename it. Starting a
bracket adds every player in it to the event, so a player picked from "Not signed up to this
event" is in the event from then on, and so does adding a late player. Merging away a player
who is in a bracket of the current event, running or finished, answers 409 `in-bracket`, so
the bracket's answer can always be made; deleting the bracket frees them. A
merge keeps the merged player's place in the event for the player kept.

### Heats API

Planned in M5 (2026-11-13). The rules of "Brackets API" apply: bodies are JSON, every answer
lists its fields, errors are `{ "error": code }`, and a missing session is 401
`not-signed-in`. The shared types are in `packages/core/src/api.ts`.

**Storage.** Heats get their own tables, engine, and routes. Sharing the bracket tables would
mean rebuilding `brackets` (its format `CHECK`) and `bracket_results` (`winner_id` and
`loser_id` are `NOT NULL`), since SQLite's `ALTER TABLE` can't change those
(<https://sqlite.org/lang_altertable.html#otheralter>), and branching an engine built around
`brackets-manager`. Migration 5 adds:

- `heat_runs`: the event (`UNIQUE`), stations, races, rounds, the points table and the
  seeding as JSON, and the creation time.
- `heat_results`: the run, the heat, the finishing order as a JSON list of player ids, the
  time, and `undone_step` and `undone_at` for an older undo.
- `heat_late_joins`: the run, its position, the player, the heat, and the step.
- `heat_tie_breaks`: the run, its position, the players as JSON, and the step.

Ids and times only (`CLAUDE.md`, rule 1); an answer joins the current handle.
`heat-engine.ts` follows the bracket engine: state in, state and answer out, the log made by
`logOf`, every answer a replay, no clock, no database. Rounds 2 and on, the final, and the
tie-break heats are derived on replay. A heat's id is `round * 100 + number`; tie-break heats
start at 1000 and the final is 2000.

| Request | Who | Answer |
|---|---|---|
| `GET /api/heats` | host or device | `{ heats }`, or `{ heats: null }` before any are made |
| `POST /api/heats` `{ stations, races, rounds, points, playerIds }` | host | 201 `{ heats }`; 409 `bracket-running`; 400 `too-few-players`, `too-many-players`, or `bad-request` |
| `POST /api/heats/results` `{ heatId, order }` | host | `{ heats, resultId }`; 409 `not-on-station`; 400 `bad-request` if `order` isn't the heat's players, each once; 404 `not-found` for a heat that isn't there |
| `POST /api/heats/undo` `{ resultId }` | host | `{ heats }`; 409 `undo-later-first`, or `nothing-to-undo` for a result not in the log or already undone |
| `POST /api/heats/players` `{ playerId }` | host | `{ heats }`; 409 `late-closed` or `already-in`; 404 `not-found` for a player who isn't there |
| `POST /api/heats/tie-break` | host | `{ heats }` with the tie-break heats made; 409 `no-tie` if no tie at the cut still needs heats |
| `DELETE /api/heats` | host | 204; the host screen asks first, since it can't be undone |

The four `POST` routes under `/api/heats/` answer 404 `no-heats` when the event has no heats.
`stations` is 1 to 8, `races` 1 to 4, `rounds` 1 to 3, and `points` 4 whole numbers that pass
`isPointsTable`. `playerIds` are 2 to 32 players; with 2 to 4, `rounds` is stored as 0.

On the host screen, a refused result (404 `not-found`, 409 `not-on-station`) reads "That group
isn't being played anymore." (`GROUP_RESULT_WORDS` in `api/errors.ts`; the same codes on the
players routes keep their own words). The record panel also closes, with a snackbar line, as
soon as an answer has its group off every station, such as after Undo on the snackbar.

The heats answer is:

```ts
interface Heats {
  id: number;
  races: 1 | 2 | 3 | 4;
  rounds: number;           // 0 when 2 to 4 players play only the final
  points: number[];         // for 1st to 4th
  finished: boolean;        // the final has a result
  lateOpen: boolean;
  lastResultId: number | null;
  round: number | null;     // the qualifying round being played; null for tie-breaks and the final
  stations: { number: number; heat: Heat | null; calledAt: string | null }[];
  upNext: Heat[];
  heats: Heat[];            // every heat made so far
  standings: { place: number; player: Player; points: number; heatsPlayed: number }[];
  finalSize: number;        // places 1 to finalSize reach the final
  ties: { place: number; players: Player[]; started: boolean }[];
}
interface Heat {
  id: number;
  kind: 'round' | 'tie-break' | 'final';
  round: number;            // the round; a tie-break's pass; 1 for the final
  number: number;           // from 1 within its round or pass
  status: 'ready' | 'playing' | 'done';
  players: Player[];        // 2 to 4
  order: Player[] | null;   // the finishing order once recorded
  resultId: number | null;  // what to send to /undo
}
```

`points` in a standings row are qualifying points; `heatsPlayed` counts qualifying heats.
Every field is named in a schema in `api-schemas.ts` with `additionalProperties: false`.

**Error codes:** as for brackets, plus `no-heats`.

**Live.** The server sends `{ type: "heats" }` when the heats change, and screens reload
them, and on `players` for renames.

**One competition per event.** An event runs a bracket or heats, not both. Both create routes
run on the one shared write chain and answer 409 `bracket-running` while either is running; a
new one of either kind replaces a finished one. The merge guard (409 `in-bracket`) checks
both, so a player in heats of the current event can't be merged away.

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
| Brackets | `brackets-manager` 1.11.1, `brackets-memory-db` 1.0.6, `brackets-model` 1.7.0 | Checked 2026-11-13. Manager: MIT, released 2026-09-20. Memory store: ISC, released 2026-05-16, the library's in-memory database that the replay rebuilds on. Model: ISC, released 2026-05-16, the library's own dependency for its types. In `packages/server` only (see Packages) |
| Client build | Vite 8.3.8, `@vitejs/plugin-react` 6.3.0 | |
| UI | React 19.3.1, MUI (Material UI) 9.5.0, `@mui/icons-material` 9.5.0, React Router 8.5.1 | MUI was Brad's choice (2026-11-12) |
| Styling engine | `@emotion/react` 11.14.0, `@emotion/styled` 11.14.1 | Peer dependencies of MUI 9.5.0 |
| Fonts | `@fontsource/roboto` 5.3.0 | Bundled for offline use |
| QR codes | `lean-qr` 2.7.4 | MIT, no dependencies, SVG output through `lean-qr/extras/svg`; released 2026-09-07. Replaces `qrcode`, whose last release was 2024-08-05. Its code makes no network requests (checked 2026-11-12) |

**Known advisory.** `brackets-manager` depends on `uuid ^9.0.0`, which has a medium
advisory, GHSA-w5hq-g745-h8pq (<https://github.com/advisories/GHSA-w5hq-g745-h8pq>): the v3,
v5, and v6 functions misbehave when given an output buffer. The library calls only `v4`.
`pnpm audit --audit-level high` passes. With an npm override to uuid 14.0.3 the library runs
and the audit is clean; the server task will try pnpm's `overrides` setting
(<https://pnpm.io/settings#overrides>), which hasn't been tried yet.

### Packages

- **`packages/core`**: handles, the vulgarity filter, PIN rules, the bracket seeding shuffle,
  the station and queue logic, the round robin ranking and tie rules, heats, the time
  estimate, and the shared API types. No DOM, Node, or network imports. Randomness (seeding,
  suggested PINs, heat groups) comes from a seeded source passed in by the caller, so every
  format can be tested with fixed results.
- **`packages/server`**: Fastify, the database, WebSockets, pairing, host sign-in, serving
  the built client, and the wrapper around `brackets-manager`. The library can't live in
  core: it is CommonJS, `manager.js` requires Node's `events` (its manager extends
  `EventEmitter`) and `uuid`, and `manager.d.ts` starts with `/// <reference types="node" />`,
  which core's lint and its ES2022-only type check refuse (rule 4). ESM named imports of it
  work. Checked 2026-11-13.
- **`packages/client`**: the Host, Sign-up, and Display screens.
