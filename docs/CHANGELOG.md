# Changelog

Finished work, newest first. When a roadmap item is done, it leaves the
[roadmap](ROADMAP.md) and is recorded here.

Until the first event, entries list finished work under **Milestones**. After it, entries
use **New Features**, **Improvements**, and **Bug Fixes**, in that order.

---

# November 17, 2026

## Milestones

* **M8 Name tags.** The host prints name tags from the host laptop through the browser's print
  dialog. The Name tags panel on `/host` has **Print 5 new tags** (the count is the print
  list, and the button is off at 0), **Print a test tag**, and a label size select, and each
  player has a **Print tag** button for a reprint. The sizes are 62 x 100 mm (the default,
  for a thermal label printer), 2-1/4 x 4 in, and a custom size from 25 to 150 mm. The handle
  is sized to fit on one line inside a 3 mm safe edge, and the 4-digit PIN sits small in a
  corner with no "PIN" word. A sign-up, a claim, a host add, and a PIN reset each add a tag
  with the plain PIN to the print list. The PIN stays there only until the host answers
  **Yes** to "Did all 5 tags print?" or 12 hours pass, and then it is gone from the database
  file. A reprint has no PIN. The host can add an event picture (PNG, JPEG, or WebP, up to
  2 MB), which shows on the tags and on the TV, and a new event keeps it. `pnpm print-check`
  prints every size to PDF in headless Chromium and checks each page size within 0.5 mm. The
  printer isn't bought yet, so the printer hand tests in `PLAYTEST.md` are still to run.

# November 15, 2026

## Milestones

* **M7 Setup wizard.** The host sets up an event in three steps on `/host`: a name (with a
  dice button for a catchy one) and an optional game name, a template (Fighting game, Racing
  game, or Another game) and a format card, then the stations and **Start**. Step 2 shows how
  long the event will take, from 5 minutes a game, 4 a race, and 4 for each changeover, worked
  round by round so several stations don't make it look shorter than it is. A calibration
  test plays the real engines and checks the estimate against them. A plan longer than the
  hours picked (3 by default) gets a warning with up to two fixes. **New event** starts a
  fresh event that players sign up for again and keeps the old bracket as it was. When a
  called player hasn't come after the wait (5 minutes by default), the station card asks
  "Still waiting?" with **They're here** and **Forfeit**, and the TV shows a call line, timed
  by the server's clock; nothing happens on its own. A bracket forfeit and a missing group
  player (0 points) can each be undone exactly. The game name shows on the TV, the Sign-up
  tablet, and the phone page. Game titles and company names are kept out of the repo, and
  the name dice can't make them. Hand tests are in `PLAYTEST.md`.

# November 13, 2026

## Milestones

* **M5 Races and free-for-all.** For racing game and fighting game free-for-alls, the host starts
  groups of up to 4, as even as possible, on 1 to 8 stations. Each group's finishing order
  scores points from an editable table (default 4, 3, 2, 1); later rounds regroup players by
  points, everyone plays the same number of groups, and the top 4 play a final whose order
  sets places 1 to 4. A tie at the cut for the final gets a tie-break group. The host records
  a group by tapping who came 1st, 2nd, and 3rd, with Undo; an older undo reopens its group
  without moving anyone playing. Late players join a round 1 group that hasn't started. One
  competition runs per event, a bracket or groups. The TV shows the stations, Up next, and
  standings with "Top 4 go to the final", then the finalists and the podium. Hand tests are
  in `PLAYTEST.md`.
* **M4 1 vs 1 brackets.** The host starts a bracket from the host screen: One life (single
  elimination with a 3rd-place match), Two lives (double elimination with the rematch for
  the title), or Everyone plays everyone (round robin), best of 1, 3, or 5, on 1 to 8
  stations. Byes go to the top seeds of a seeded shuffle. Each station shows its match with
  a big winner button per player; a tap records the result, and any result can be undone:
  the newest exactly, an older one by reopening its match at the front of Up next without
  moving anyone being played. Places 1 to 3 are never shared, so a round robin tie there
  gets a tie-break round. A late player fills a first-round bye until round 1 is finished,
  only if no played or called match changes. The TV shows the stations with timers, Up next,
  and the bracket in round columns, readable at 32 players on one screen. The server keeps
  each bracket as a result log and rebuilds it with `brackets-manager`, because the
  library's own undo and late seeding left brackets wrong in testing. Hand tests are in
  `PLAYTEST.md`.

# November 12, 2026

## Milestones

* **M3 Pairing and live screens.** The host signs in with a password, set in
  `COLISEUMGRID_HOST_PASSWORD` or, on the offline laptop, chosen on first run. The host
  screen makes a 6-character code with a QR code for a TV or a sign-up tablet, lists paired
  screens, and unpairs them. The plain address opens the join screen, so a TV remote types
  only the host and port. Codes work once, expire after 10 minutes, and are limited per
  address and across all callers. Paired screens get changes over a WebSocket; on the Unraid
  server a renamed event reached a paired display in 156 ms. The Display screen shows the
  event name, with places for "Up next" and the timer. A security review closed requests from
  pages on another port, a limiter that a flood of addresses could stall, and old sessions
  outliving a password change. Hand tests on real devices are in `PLAYTEST.md`.
* **M2 Players and sign-up.** Players sign up on the Sign-up screen with a handle and a
  4-digit PIN, suggested for them. A taken handle asks for its PIN. The handle filter in
  `core` is ported from Pattern Break and tightened: capital letters inside a handle count as
  word breaks, digits read as look-alike letters, and spelled-by-sound variants are listed.
  The server checks every handle whatever the client sent, and its tests run in Node and in
  Chromium. The host's player list adds, renames, merges, and resets PINs. In online mode,
  wrong PINs are limited per handle and claims per address. The Reset PIN window now opens at
  the tap and shows the new PIN when it arrives, after Brad saw it fail to open on his phone;
  the cause wasn't reproduced. Screens fit a 320 px wide phone.
* **M1 Workspace and checks.** The pnpm workspace with `core`, `server`, and `client`.
  `pnpm check` runs Oxlint, the type checks, Vitest, the docs check, and the palette check,
  and CI runs it with `pnpm build` and `pnpm audit` at high. The server answers
  `/api/health` and serves the client. The client has the red and black MUI theme in light
  and dark, the arena bracket logo, and placeholder Host, Sign-up, and Display pages. The
  Docker image is smoke-tested in CI and published to `ghcr.io/bradbrownjr/coliseumgrid:edge`.
  lean-qr replaces `qrcode` for QR codes. The audit step was not shown failing on a real
  advisory; Brad chose not to add a vulnerable package to prove it.
* **Colors and logo.** A red and black palette for light and dark, checked for contrast
  under normal vision and simulated protanopia and deuteranopia, and a logo redrawn as SVG
  from an AI-generated concept.
* **Plan and working rules.** The design (`PLAN.md`), UI rules (`DESIGN.md`), build order
  (`ROADMAP.md`), writing rules (`DOC-STYLE.md`), hardware tests (`PLAYTEST.md`), and the
  agent instructions (`CLAUDE.md`), drawn from ECTLogger, MEPN, and Pattern Break. CI runs
  the docs check.
