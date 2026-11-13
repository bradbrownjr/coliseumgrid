# Play-tests

Tests that need a person or real hardware. Brad runs them as time allows; what one finds
becomes a roadmap item. A test is removed once it's reported.

Each test names the milestone that makes it possible. None can be run yet.

## Planned

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
