# Play-tests

Tests that need a person or real hardware. Brad runs them as time allows; what one finds
becomes a roadmap item. A test is removed once it's reported.

Each test names the milestone that makes it possible. The tests marked "after M3", "after
M4", "after M5", "after M7", and "Phones, over plain HTTP", can be run on the Unraid server
(`http://10.6.26.2:8390`).

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
  with 2 rounds, 1 game in each group, and the default points. Does the dialog say "3 groups
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
  are tied, how many go to the final, and that a tie-break group is coming? Is the cut line
  above the tied players, not under them?
- Tap **Play tie-break**. Are the tie-break groups on the stations, labelled "Tie-break group"?
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

### Phones, over plain HTTP (after M6)

Why: the server's tests use made-up requests and no phone. These use real phones on the
event network, on the Unraid server (`http://10.6.26.2:8390`, offline mode). Over plain HTTP the
page has the page alert only (`PLAN.md`, "Player view").

- Sign up a new player on the tablet. On the Done screen, scan the QR code with a phone
  camera. Does the player page open and show the handle, with no PIN asked? Does the Done
  screen stay 30 seconds with the code? Open the sign-up screen on the laptop at `localhost`:
  is there no QR code, and does the screen move on after 15 seconds?
- On a second phone, open `/follow` and follow the same handle by typing the handle and the
  PIN. Does it work? Does a wrong PIN say "That handle and PIN don't match. Check both and try
  again."? Does a handle nobody has give the same words? After 5 wrong tries on one handle
  does it say "Too many tries. Wait 10 minutes, then try again."?
- Start a bracket and record results from the host. Does the phone's card change within a
  second each time, with no reload?
- When the player is called to a station: does the full-screen alert show "You're up!" and
  "go to station N!", pulse once a second, and play the three beeps (after a tap anywhere on
  the page earlier)? Does the Android phone buzz? Does the tab title flip? Does **On my way**
  close it? Does it stay steady with the phone's reduce motion setting on?
- When the player is next: does a blue banner show "you're next! Get ready." with no sound?
  When two away: does the card say "Two matches away"?
- Follow two kids on one phone. Is it clear whose match is up? Does "Follow another player"
  switch off at 6?
- Tap **Stop following** on one. Does it ask first? After yes, does the phone keep the other
  kid? Stop the last one: does the phone go back to the sign-in?
- Reset a followed player's PIN from the host. Does that phone lose the player within a
  second, and go back to the sign-in if it followed only them? Does the old PIN stop working
  and the new one work?
- Does the phone stay signed in after the browser is closed and reopened?
- Sign in on a phone 20 times in a row with right PINs (use a few handles). Does every one
  work, with no "Too many tries"?
- Is there no lock screen alerts control on the page over HTTP?
- Run groups with several players on a phone. Do the standings show followed rows bold with a
  person icon and the cut line "Top 4 go to the final"? Is everything readable on the
  smallest phone available, with no sideways scrolling?
- Lock the screen on an Android phone and an iPhone before the player is called. Does the
  alert sound when the player comes up? After 5 minutes locked? After 15? (Whether a locked
  page can alert is undocumented, and the offline plan depends on it.)

### Phones, over HTTPS (after M6)

Why: push, the wake lock, and the Home Screen app work only in a secure context. This needs
a reverse proxy in front of the server, a certificate the phones trust, `COLISEUMGRID_MODE=online`,
`TRUSTED_PROXY`, and `COLISEUMGRID_PUSH_SUBJECT` (`mailto:` or `https:`, not `localhost`). Which
proxy, DNS, and domain to use is Brad's choice, and any firewall or DNS change needs his
approval first (`PLAN.md`, "HTTPS on a venue network").

- Open `/follow` on an Android phone in Chrome and sign in. Does **Turn on lock screen
  alerts** show? Turn it on and allow the question. Close the page and lock the phone. Have
  the host call the player. Does a notification arrive, saying "<handle>, go to station N!"?
  Does tapping it open the player page? Does the "next" alert arrive too?
- The same in a desktop browser (Chrome, then Firefox if available).
- On an iPhone with iOS 16.4 or later, open `/follow` in Safari. Does the control tell you to
  add it to the Home Screen? Add it, open it from the Home Screen, and sign in again. Turn on
  alerts, lock the phone, and have the host call the player. Does the alert arrive?
- Does the Home Screen icon look right (the mark centered, on a light background, not black
  behind it)? Does the app open on the player page? On Android, is the icon right in both
  the round and square shapes the launcher uses?
- Does the screen stay on while the player page is in front?
- Record the push service host of each subscription made above: the part of the endpoint
  after `https://`, up to the first `/`, which is in the browser's `PushSubscription` or the
  server's `push_subscriptions` table. The Chrome and Firefox hosts are
  from published docs but not yet seen on a real subscription (`PLAN.md`, "Player view"). Does every subscription pass the allow-list
  (`PUT /api/phone/push` answers 204, not 400)?
- Sign out on a phone with alerts on. Does it stop getting alerts? Sign in as another player on
  the same phone. Is the control back to "off"?
- Delete `vapid-private-key.pem` from the data folder and restart the server. Open the page on
  a subscribed phone. Does it subscribe again with no tap, and do alerts keep arriving?
- Does a phone that follows nobody get no alerts, and does no player's alert reach a phone
  that follows someone else?
- Type 5 wrong PINs for one handle on a phone. Does the phone say "Too many tries"? Does the
  Sign-up tablet still sign that player in with the right PIN? Type 5 wrong PINs on the
  tablet: is the phone locked for that handle too?
- Turn alerts on for 11 phones that follow one player (or a browser profile each). Does the
  oldest stop getting alerts, and do the other 10 keep getting them? Does the host stay
  responsive when a result goes in with all 11 subscribed?

### Setup wizard and no-shows (after M7)

Why: the server's tests and the browser checks use made-up players. These use a real kid, a
real TV, and real time, on the Unraid server (`http://10.6.26.2:8390`, offline mode). Run them
after the M7 deploy.

- Hand a kid the host laptop with nothing explained and ask them to set up an event and start
  it with the wizard. Write down every question they ask and where they paused. Each one is a
  wording or layout item.
- Tap the dice on step 1 for each template (Fighting game, Racing game, Other). Are the names
  fun? Does any feel off, rude, or like a real game or show? Note each one.
- Pick a template and type a game name. After **Start**, does the name show under the event
  name on the TV, on the Sign-up tablet, and on the player's phone page?
- Read the estimate on step 2 for 8 players on 2 stations. Then run a practice
  session with kids. Time each game and each changeover between games with a stopwatch, and
  compare the real finish with the estimate. Record the real minutes per game and per
  changeover for each template, so the defaults (5, 4, and 5 minutes, and 4 minutes of
  changeover) can be changed to match.
- Choose a plan that is too long for the hours picked. Does the warning show, with up to two
  fixes? Does each fix button change the plan and clear the warning once it fits?
- After a competition finishes, tap **New event** and name it. Do the players list and the
  TV start empty? Does the old event's bracket stay as it was? Does a returning kid sign up
  again with the same handle and PIN?
- While a bracket is running, try **New event**. Can you start one, and does the screen say why not?
- After a finish, tap **New competition**. Do the same players stay, and does the wizard
  start from the plan the event had?
- Start a bracket and call a match to a station. Leave one of its players away. After the wait
  (use 3 minutes), does the station card ask "Still waiting?" Does the TV show the call line
  naming both players? Tap **They're here**: do the prompt and the TV line go away, and does
  Undo in the snackbar bring the wait back? Call the match again after an undo of a result:
  does it start a new wait?
- Let the wait pass again and tap **Forfeit**. Pick who is missing. Is the other player the
  winner, is the match marked "Forfeit" in the bracket and the results list, and does Undo
  put the match back on its station?
- Start groups and let one player not come. Tap **Forfeit** on the group, mark them missing,
  and put the others in order. Does the missing player get 0 points, and does the group count
  for the others? Make a final with a missing player: are places 1 to 3 each given to one
  player?
- Make a tie that needs a tie-break. Does the tie-break go on a station only after **Play
  tie-break** is pressed, and does its wait start from that press, not from the last result?
- Open `/host` in a second window. Change the plan in one window (for example the number of
  stations on step 3). Does the other window show the change within a second or two, and
  does typing in a window with unsaved changes stay as typed?
- Set a device clock (the TV or the tablet) a few minutes wrong. Does the timer on the TV still
  count from the time the station was called?
- Look at every wizard step at the sizes the hardware has: the laptop, a tablet, and a phone.
  Can a 12-year-old reach **Start** without scrolling past anything they need?

### Label printer (after M8)

Why: whether the driver offers the label size in the browser's print dialog, and what the
dialog does with it, couldn't be verified from published sources (`PLAN.md`, "The printer").
This needs the Brother QL-800 and DK-11202 labels (62 x 100 mm).

- Install the printer on the Windows laptop and on the Fedora laptop (Brother's driver; on
  Fedora, `ptouch-driver` if Brother's doesn't work). Is 62x100 listed as a paper size? Set it
  as the default.
- Print the test tag from Chrome, Edge, and Firefox, on each laptop. Is anything cut off at
  the 3 mm outline? Does the tag read across when worn?
- In Chrome, try the dialog's Margins on Default, None, and Minimum. Which print the tag full
  size? The source suggests only Default.
- Print 5 new tags in one job. Do they come out one per label, with none blank between?
- Is the PIN readable up close and hard to read from two meters? Is the longest handle
  readable from across the room?
- Print a tag with a color graphic. Does it come out clear in black and white?
- Answer **No, keep them** after a cancelled print. Are the tags still there? Answer **Yes**
  after a real print. Are they gone?
- Reset a player's PIN while "Did all 5 tags print?" is open, then tap **Yes**. Is that
  player's new tag still waiting to print, with the new PIN?
- Upload a color picture for the event. Does it show beside the event name on the TV?

### Offline bundle (after M9)

- On the Windows laptop with no network: run the launcher. Does Windows Firewall ask, and
  do the tablets and TV connect after allowing it?
- The same on the Fedora laptop.
- On the laptop, open the host screen from the launcher (it opens at `localhost`) and tap
  **Add a TV**. Type the address the panel shows into the TV's browser. Does the join screen
  open? With the laptop on Wi-Fi and a cable at once, or with a VM or VPN adapter, is the
  first address in the list the one the TV can reach?
- In one browser, pair the laptop as a Display and sign in as the host in another tab, then
  tap **Sign out** on the host tab. Does the Display tab keep updating without a reload?

### Dress rehearsal (after M10)

- A full mock event with family or friends, run by Brad's son: sign-up, a fighting game bracket, a
  racing game heat round, name tags. Note everything he had to ask about.
