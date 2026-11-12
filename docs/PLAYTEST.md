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

### The travel router (after M3)

Why: devices reconnect by address, so the laptop's address has to stay the same.

- Set a DHCP reservation for the laptop. After a restart of both, does a paired TV
  reconnect without a code?

### Tablets (after M3)

- Scan the host's QR code with the tablet's camera app. Does the join page open with the
  code filled in?

### Label printer (after M7)

Why: label sizes and printer margins vary by printer and driver.

- Print a name tag from each preset. Is anything cut off? Is the PIN readable up close and
  hard to read from two meters?

### Offline bundle (after M8)

- On the Windows laptop with no network: run the launcher. Does Windows Firewall ask, and
  do the tablets and TV connect after allowing it?
- The same on the Fedora laptop.

### Dress rehearsal (after M9)

- A full mock event with family or friends, run by Brad's son: sign-up, a Smash bracket, a
  Mario Kart heat round, name tags. Note everything he had to ask about.
