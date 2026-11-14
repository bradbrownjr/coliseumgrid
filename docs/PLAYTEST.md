# Play-tests

Tests that need a person or real hardware. Brad runs them as time allows; what one finds
becomes a roadmap item. A test is removed once it's reported.

Each test names the milestone that makes it possible. The tests marked "after M3", "after
M4", or "after M5" can be run on the Unraid server (`http://10.6.26.2:8390`).

## Planned

### Host sign-in, pairing, and live updates (after M3)

Why: the server's tests use made-up requests. These use real browsers, a real camera, and a
real network.

- Open `/host` and sign in. Change the event name.
- Tap **Add a TV**. On another device, open the plain address and type the code. Does it
  land on the Display screen? Change the event name on the host. Does the TV show it within
  a second?
- Scan the QR code with a phone camera. Does the join page open with the code filled in,
  and join by itself?
- Tap **Add a sign-up tablet** and pair a second device. Does it land on the Sign-up screen?
- Unpair one device from the host's list. Does it go back to the join screen? Does the new
  device show up in the host's list within about 5 seconds?
- Tap **Reset PIN** on a player several times. Does the window open every time? (Brad saw it
  fail on his phone in M2; the cause wasn't found.)

### The TV device (after M3)

Why: the Display screen has to work on the device that will run it, and no CI browser is an
Android TV stick.

- Install a browser on the TV device. Does the display page run full screen, in the desktop
  layout?
- Turn off the device's sleep and screensaver. Does the screen stay on for two hours?
- Pick the smallest readable type size from where players will sit. Record it in
  `DESIGN.md`.
- Type the join address and code with the remote. How long does it take?

### Colors on the TV and projector (after M3)

Why: `tools/check-palette.ts` computes contrast from the hex values. It can't see a TV or
projector washed out by room light.

- Show the Display screen on the real TV with the lights on and with them off. Can you read
  the handles, the "Up next" marker, and the "Winner" and "Out" labels from where players
  sit?
- Do the crimson buttons and the red text (`primary.light`) look different from the magenta
  error color?
- Show it on the projector, if one is used. Is gold (win) still clearly different from gray
  (loss)?
- Ask a red-green color blind person, if one is around, to point out the winner and the
  next match, and the crimson buttons on the dark background. If the buttons are hard to
  find, add a `primary.light` border to contained buttons in dark mode.

### The travel router (after M3)

Why: devices reconnect by address, so the laptop's address has to stay the same.

- Set a DHCP reservation for the laptop. After a restart of both, does a paired TV
  reconnect without a code?

### Tablets (after M3)

- Scan the host's QR code with the tablet's camera app. Does the join page open with the
  code filled in?

### Brackets (after M4)

Why: the server's tests use made-up players and no screen. These use real phones, tablets,
and a TV.

- Sign up 8 players on two tablets. Start a One life bracket on 2 stations. Does each station
  show a card with a "won" button for each of its players?
- Record each result from the host's phone with one tap. Does the next match move to a free
  station? Is "Up next" in the right order?
- Tap Undo in the snackbar after a result. Does the match go back on its station with the
  same two players? Record that result again, then undo it from the Results list. Is the
  bracket the same as before the result?
- While recording a result, watch the TV. Does it show the change within a second?
- Start a One life bracket with 7 players, so one first-round bye exists. Before round 1 is
  finished, add the eighth player with "Add to bracket". Does the new player get a match
  against the player who moved on? Do the matches already on stations keep their players?
- Start a Two lives bracket. Play until the first final is decided. Does "Rematch for the
  title" appear only when the player from the One life left side won that final? Does it
  show on the TV and on a station?
- Start a round robin of 5. Record results until two players tie for 1st. Does the host
  show "Tie for 1st" with "Play tie-break", and does the TV show the tie? Tap "Play
  tie-break". Are the tie-break matches on the stations? Record them. Does the tie-break
  leave one player in 1st?
- Start a One life bracket with 32 players. Stand where the players sit. From there, can you
  read every handle, the station numbers, and "Up next"? Note the distance and the smallest
  type that worked, and record it in `DESIGN.md`, "Display (TV)".

### Groups (after M5)

Why: the server's tests use made-up players and no screen. These use real phones, tablets,
and a TV, on the Unraid server.

- Sign up 10 players on two phones or tablets. Start races and free-for-all on 2 stations,
  with 2 rounds, 1 race in each group, and the default points. Does the dialog say "3 groups
  in round 1: 4, 3, and 3 players"? Do the first two groups go on the stations?
- Record each group's cup order from the host's phone. Tap the players in finishing order.
  After one tap, does the panel ask "Who came 2nd?" and fill in the last player? Does Save
  stay off until the order is complete?
- Record a group, then tap Undo in the snackbar. Does the group go back to Up next with the
  same players? Does the station it freed keep its next group?
- Record three results. Then undo the first one from the Results list. Does that group reopen
  at the front of Up next, while the groups on stations keep their stations and timers?
- Make a tie at the cut. Try the default points first. If no tie comes up, start a new groups
  event with 1, 1, 1, 1 points, which makes ties likely. Does the banner say the tied players
  are tied, how many go to the final, and that a tie-break race is coming? Is the cut line
  above the tied players, not under them?
- Tap **Play tie-break**. Are the tie-break races on the stations, labelled "Tie-break race"?
  Record one. Does the banner clear, and does the final show its four players?
- Finish the final. Does the TV show "Final standings", with 1st, 2nd, and 3rd each in its own
  box? Is 1st in gold with the word "Winner"? Does no place in the top three share?
- Before round 1 is finished, add a player with **Add to group**. Do they go into a round 1
  group that is still waiting, and not the one on a station? Do the groups on stations keep
  their players? Do they play as many groups as everyone else by the end?
- Sign up 32 players and start groups on 8 stations. Record one group. Stand where the players
  sit. Can you read every handle, the points, the groups played, and the cut line? Does the
  table split into two side by side? Note the distance and the smallest type that worked, and
  record it in `DESIGN.md`, "Display (TV)".

### Alerts on players' phones (after M6)

Why: whether a page can alert a phone whose screen is locked isn't documented, and the
offline plan depends on the answer (`PLAN.md`, "Player view").

- On an Android phone and an iPhone, over plain HTTP on the event network: open the player
  page, tap once to allow sound, then lock the screen. Does the alert sound when the player
  comes up? After 5 minutes locked? After 15?
- The same over HTTPS, and from an iPhone Home Screen web app.
- Does the phone stay signed in after the browser is closed and reopened?
- With a parent's phone following two handles, is it clear whose match is up?

### Label printer (after M8)

Why: label sizes and printer margins vary by printer and driver.

- Print a name tag from each preset. Is anything cut off? Is the PIN readable up close and
  hard to read from two meters?

### Offline bundle (after M9)

- On the Windows laptop with no network: run the launcher. Does Windows Firewall ask, and
  do the tablets and TV connect after allowing it?
- The same on the Fedora laptop.

### Dress rehearsal (after M10)

- A full mock event with family or friends, run by Brad's son: sign-up, a Smash bracket, a
  Mario Kart heat round, name tags. Note everything he had to ask about.
