# ColiseumGrid build plan

> This is the design. What gets built next is in [`ROADMAP.md`](ROADMAP.md), what is
> finished is in [`CHANGELOG.md`](CHANGELOG.md), the UI rules are in
> [`DESIGN.md`](DESIGN.md), and how to work on the code is in
> [`DEVELOPMENT.md`](DEVELOPMENT.md). Nothing here is built unless the changelog says so.

## 1. Pitch

A tournament app for an afternoon of video games in one room. Kids sign up at a tablet with
a gamer handle and get a printed name tag. The host runs the event from a laptop: 1 vs 1
brackets for fighting games, and race heats for racing games. A TV
shows the bracket, the standings, who plays next, and a match timer. Handles are remembered,
so a player's results carry over from one event to the next.

It runs with no internet on a laptop and a travel router, or online from a Docker image.

The first event is on July 10, 2027.

## 2. Principles

1. **A 12-year-old can host it.** The setup has three steps, with the defaults filled in.
   Everything else is under "More options". The only typing it needs is the event name. Every
   screen is written for a kid to read (see `DOC-STYLE.md`).
2. **Offline first.** Every feature works with no internet connection. Fonts, icons, and
   images are bundled; nothing is loaded from a CDN at runtime. Web Push is the one feature
   that needs the internet; it is online-only, and the page alert works without it.
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

The design below was settled on 2026-11-14. The research behind it was checked that day.

**Phones are not devices.** `devices.role` has a `CHECK` that allows only `display` and
`signup`, and SQLite's `ALTER TABLE` can't change a `CHECK`
(<https://sqlite.org/lang_altertable.html#otheralter>). Phones also sign themselves in, with
no code from the host. So a phone gets its own table and its own cookie, `cg_phone`: 32 random
bytes stored as a SHA-256 hash like the other tokens, `HttpOnly`, `SameSite=Strict`, `Secure`
over HTTPS, and 400 days. It lasts until the phone signs out or a PIN reset leaves it
following nobody. A phone can read `GET /api/event` and `GET /api/live`, and it gets one
narrow answer, `GET /api/phone`. It can't call the bracket, groups, players, or sign-up
routes, so it never sees a roster (`CLAUDE.md`, rule 1). The routes are in "Phone API".

**Signing in, two ways.**

- **Handle and PIN.** A phone-only route, not `/api/signup/claim`: that route is Sign-up-only,
  and it marks the player as at today's event. Both routes use one PIN check (`pinGuard` in
  the server). Phones are limited in both modes, per handle (5 wrong per 10 minutes) and per
  client IP (60 wrong per 10 minutes), because phones, unlike tablets, aren't paired by the
  host. Only wrong tries count toward the 60, an unknown handle among them, so one address
  can't walk through the handles. A right PIN, a handle the phone already follows, and a
  full phone give their try back, so a room of players behind one address isn't stopped.
- **Phones only lock phones** (Brad, 2026-11-14). The per-handle wrong count is kept twice.
  The phone count locks the phone route: wrong PINs on the phone route count in it, and online
  so do wrong PINs on the tablet's claim, so the tablet can't give a handle more than 5 phone
  tries in all. The tablet count locks the claim route, online only, and only the tablet's
  own wrong PINs count in it, so phone failures never lock the paired tablet. A right PIN on
  either route clears both counts. A PIN that was right when typed but was reset while the
  check ran is refused as `wrong-pin` and isn't counted.
- **One answer for an unknown handle and a wrong PIN** (Brad, 2026-11-14): `POST
  /api/phone/follow` answers 401 `wrong-pin` for both, so the route can't be used to list
  handles. An unknown handle spends the same hash as a wrong PIN, so timing matches, and
  counts toward the per-IP limit, but keeps no per-handle count: handles are the caller's
  choice, and a count each would let one address fill the limiter with made-up keys. The page
  says "That handle and PIN don't match. Check both and try again." A handle that exists
  and is locked still answers 429, so a caller who sends 6 wrong PINs can tell a real handle
  from an unknown one; that costs the 5 tries a handle allows and shows only that the handle
  exists. The tablet's claim route keeps its own `not-found`.
  A phone that already follows the player skips the PIN. A phone that follows 6 players gets
  409 before any PIN is checked, for every handle, so the answer says nothing about who
  exists. At the limit, the page says "Too many tries. Wait 10 minutes, then try again."
- **The QR code on the Sign-up done screen.** The answers of `POST /api/signup` and
  `POST /api/signup/claim` carry a follow code, made only after the PIN was set or proven, so a
  Sign-up tablet can't make one for any player. It follows the pairing code rules: the same
  alphabet and length (`generateJoinCode`), works once, expires after 10 minutes, and wrong
  codes are rate limited with the join route's limits: the same per-IP and all-callers counts
  as wrong pairing codes (10 per IP and 100 in all, per 10 minutes), so guessing one kind of
  code doesn't get around the limit on the other. A right code (a follow code or a pairing
  code) gives back its own try and leaves the counts of wrong ones alone. A phone that already follows 6 players gets
  409 before the code is spent, so a full phone doesn't burn a good code. The QR code holds
  `${location.origin}/follow?code=K7M4QX`. The page uses the code at once and removes it from
  the address, like the join screen. The done screen stays up for 30 seconds when it shows the
  QR code (Brad, 2026-11-14) and 15 seconds without one, so a kid has time to scan it. There
  is no QR code when the Sign-up page is on `localhost` or a loopback address, because a phone
  can't reach it and the code would be spent on a dead link.

**Several handles.** A phone follows up to 6 players (`PHONE_FOLLOWS_MAX`); a parent with two
kids signs in twice, or scans two codes. "Follow another player" on the page takes a handle
and PIN, and is switched off at 6. **Stop following** asks first ("Stop following Zap?", with
"You need their PIN to follow again."), because following again needs the PIN. Stopping the
last follow signs the phone out.

**Where a player stands** is a pure function in `packages/core` (`playerStatus`), so the
server and the page agree. It reads the same answer the Display gets:

| Status | Meaning |
|---|---|
| `now` | A station holds a match or group with the player. The station and the others are known. |
| `next` | The player is in the first entry of Up next. |
| `two-away` | The player is in the second entry. |
| `later` | The player is in a later entry. `away` counts from 1. |
| `waiting` | The player is in a match that isn't ready (the other player isn't known), is between group rounds, is held back for a first-round bye, or is tied and waiting for a tie-break. |
| `out` | A bracket player with no match left while others play (in a round robin, every match is played). In groups, a player below the cut after qualifying. |
| `done` | The event is finished. The final place comes with it. |
| `not-in` | The player isn't in the bracket or groups, or nothing is running. |

"Away" counts entries of Up next, not players, and a match or group is one entry. With
several stations, or a player still on a station, the queue can skip an entry when it fills a
station (see "Stations and the queue"), so the page says "about 2 matches away".

**Alerts** come from the status, per distance:

- **Called** (`now`): a full-screen alert, MUI `Dialog fullScreen`, crimson and black. It
  pulses from crimson to black and back once a second and stays steady under
  `prefers-reduced-motion`, which is under WCAG's limit of 3 flashes a second
  (<https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html>). It
  says "You're up!", then "Zap, go to station 2!" for each player called, and "With Kai"
  when others are known. The page title flips between "Zap: go to station 2" and the page
  name, a Web Audio beep plays, and `navigator.vibrate` runs where it exists (not on iPhone,
  <https://caniuse.com/vibration>). An **On my way** button closes it.
- **Next** (`next`): a banner at the top of the page, "Zap, you're next! Get ready.", with a
  close button, and no sound.
- **Two away** (`two-away`): a line of text on the player's card ("Two matches away", or
  "Two groups away").

`newAlert` in `packages/core` decides when one is new: `called` when a player becomes `now`, or
is on a different match or group than before, and `next` when a player becomes `next`. With
nothing earlier to compare, such as the first load, there is no alert. Sound needs a first
tap: the page offers "Tap to turn on sound", and the tap resumes the `AudioContext`, which
starts suspended when it is made before a user gesture
(<https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay>). A hidden page can be
frozen, which stops its timers and fetch callbacks, and playing audio is a reason not to
(<https://developer.chrome.com/docs/web-platform/page-lifecycle-api>); so page alerts on a
locked phone stay a `PLAYTEST.md` item. Over HTTPS the page holds a screen wake lock, and
asks for it again when the page becomes visible, because the browser drops it when the page
is hidden (<https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API>).

**Push** (online only, over HTTPS, and nothing else): the server sends an alert through the
push service of the player's browser. The push API is `[SecureContext]`, its payloads are
encrypted (RFC 8291), and `applicationServerKey` is the server's VAPID key
(<https://www.w3.org/TR/push-api/>). A service worker needs a secure context too
(<https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API>).

- **Keys.** The VAPID key pair is made once, on first need, and kept in the file
  `vapid-private-key.pem` in `DATA_DIR`, not in the database. The subject is the setting
  `COLISEUMGRID_PUSH_SUBJECT`. A key file that can't be read is never replaced: push turns
  off with a warning in the log, and the server keeps running.
- **Sender.** `node:crypto` and `fetch`, no dependency (Brad, 2026-11-14). The server POSTs to the
  subscription's endpoint (RFC 8030, <https://www.rfc-editor.org/rfc/rfc8030>) with `TTL: 300`
  and `Urgency: high`. `Authorization` is a VAPID header, an ES256 JWT with `aud` the
  endpoint's origin, `exp` 12 hours out (the limit is 24), and `sub` the
  `COLISEUMGRID_PUSH_SUBJECT` setting (a `mailto:` or `https:` URL, never `localhost`), because
  Apple may refuse a `localhost` subject
  (RFC 8292, <https://www.rfc-editor.org/rfc/rfc8292>; the `web-push` README for Apple). The body is
  `aes128gcm` from RFC 8291 (<https://www.rfc-editor.org/rfc/rfc8291>): ECDH on P-256, a 16-byte
  authentication secret, HKDF, one record. Its Appendix A has test values, and the tests
  check the sender against them. The encryption hides the content from the push service, not
  the timing, the size, or who talks to whom (section 7 of the RFC). The payload has the
  handle and the station only. Node 26.13 has `createECDH('prime256v1')`, `hkdfSync`, and
  `aes-128-gcm`, checked on the dev box.
- **Where it may send.** An endpoint has to be `https:` on port 443, not an IP address, and on
  an allow-list of push service hosts, so the server can't be made to POST to an internal
  address. Apple documents `https://*.push.apple.com`
  (<https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers>).
  The list is `fcm.googleapis.com` (Google), `updates.push.services.mozilla.com` (Firefox),
  `*.push.apple.com`, and `*.notify.windows.com` (Edge); `web-push.ts` cites a source for
  each, checked 2026-11-14. No real subscription from Chrome or Firefox has been seen yet, so
  those two hosts stay unconfirmed until `PLAYTEST.md` records the hosts of real subscriptions.
  A wrong list refuses a phone's subscription (400 `bad-request`) and sends nothing.
- **When.** Every change to the competition (a save, start, delete, rename, merge, or event
  change) drops the kept answer, and the drop schedules a check with `setImmediate`, so it
  runs after the write has answered. The check works out the status of every player in the
  bracket or groups and compares it with the last one it saw (kept in memory), using
  `newAlert`. A player's alert goes to every subscription of every phone that follows them,
  at most 8 at a time (`MAX_PARALLEL_SENDS`; the rest wait in a queue), each with a
  10-second timeout. A new bracket or set of groups starts from
  "not in it", so its first calls alert. The first check after startup only records the
  statuses, so a restart sends nothing. A 404 or 410 from the push service (`gone`) deletes
  the subscription (404: expired; 410: no longer valid;
  <https://web.dev/articles/push-notifications-web-push-protocol>); Apple's 410 is "The
  device token has expired" (Apple's page above). Any other failure keeps it and sends
  nothing more. Those are the only codes that say the subscription is dead: 400 means a bad
  header, 413 a payload too large, and 429 a rate limit (the same web.dev table), and 401
  and 403 mean the VAPID key was refused (RFC 8292, sections 2 and 4.2). They describe
  the server's request, so deleting on them would wipe every subscription over a bug or a
  clock. Signing out deletes it. A check that throws logs a warning and never fails a
  write.
- **Limits on stored subscriptions.** A player keeps at most 10 subscriptions
  (`PUSH_SUBSCRIPTIONS_PER_PLAYER_MAX`), counted over the phones that follow them. When an
  11th phone subscribes or follows, the oldest is dropped, so someone who knows a PIN can't
  add phones until every alert fans out to all of them. A phone's age for a player is the
  later of its subscribing and its following. The dropped phone stays signed in without
  alerts. A phone not seen for 90 days is deleted with its follows and subscription, at
  startup and once a day (`phone-purge.ts`).
- **Payload.** JSON, `{ alert, handle, station }`: `alert` is `called` or `next`, and
  `station` is a number only with `called`.
- **Offline or plain HTTP.** Push is on only online, with `COLISEUMGRID_PUSH_SUBJECT` set and
  a key that loads, and a request must also arrive over HTTPS. Otherwise `GET /api/phone/push`
  answers `{ "publicKey": null }`, the page shows no push control and registers no service
  worker, and `PUT /api/phone/push` answers 409 `push-off`. A subscription is refused with
  400 `bad-request` unless its endpoint is on the allow-list and its keys are a P-256 point
  and a 16-byte secret. A browser's endpoint that another phone holds moves to the newest
  phone to subscribe with it, because one browser that signed in as a new phone is the same
  browser.
- **The worker and the manifest.** `push-worker.js` and `manifest.webmanifest` are at the
  site root, built by `packages/client/vite.push-assets.ts`: the worker as its own script,
  because a classic service worker can't import chunks. The worker registers only on the tap
  that turns alerts on (a page that already has a subscription made with an older key is the
  one exception: it subscribes again with the new key, with no tap). It handles only `push`
  and `notificationclick`, and has no `fetch` handler, so it can't serve a stale app. A tap
  on a notification focuses the open player page or opens `/follow`.
- **What a notification says.** The words are the page's own, from `alertWords.ts`: "Zap, go
  to station 2!" for `called`, "Zap, you're next!" for `next`, one notification per handle
  (a newer one replaces it and still buzzes). A payload that is missing, isn't JSON, or has
  the wrong fields shows a plain "ColiseumGrid" notification, because browsers need a
  notification for every push.
- **Keeping it in step.** When the page reaches the signed-out state (sign-out, stopping the
  last follow, a PIN reset, or the host cutting the phone off), it drops its own browser
  subscription, so the next player on that phone doesn't inherit it. When the server's key
  changes, the page subscribes again with the new key.
- **iPhone and iPad.** Push works only inside a Home Screen web app, iOS 16.4 and later, with
  a manifest whose `display` is `standalone` or `fullscreen`, and the permission asked from a
  tap (<https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>). A Home
  Screen app doesn't share cookies with Safari
  (<https://bugs.webkit.org/show_bug.cgi?id=181849>), so the phone signs in again there. The
  manifest (`start_url: /follow`, bundled icons) and `apple-touch-icon` are linked from the
  player page only, so only `/follow` can be added to a Home Screen. In Safari the control
  says to add the page to the Home Screen and sign in again there.

**HTTPS on a venue network** isn't built into the app. Push and the wake lock need a hostname
a phone trusts, with its own certificate: Let's Encrypt can issue one for a host that isn't
reachable from the internet through its DNS-01 challenge
(<https://letsencrypt.org/docs/challenge-types/>), or a private certificate authority can be
installed on each phone (<https://support.apple.com/en-us/102390> for iOS). It also needs a reverse
proxy on another machine, `TRUSTED_PROXY` set, `Host` passed through, and the WebSocket
upgrade forwarded (see `DEVELOPMENT.md`, "Docker"), and push needs the server to reach the
internet. Which proxy, DNS, and domain to use is Brad's choice, and any firewall or DNS
change needs his approval first.

**The host.** A PIN reset cuts every phone off from that player (Brad, 2026-11-14): the
follow is removed from each phone that had it, and a phone left following nobody is signed
out and its live connection closes. A parent's phone keeps their other kids. Signing in
again needs the new PIN. This is how the host cuts a phone off; there is no phone list on the host screen
in M6. A merge moves each phone's follow to the player kept, like the event's player list.

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
  the Display frame. Planned for M7 (Brad, 2026-11-14): the setup wizard takes this over and
  adds the game's name (see "The setup wizard" in section 6).

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
| `PUT /api/event` `{ name, game? }` | host | `{ event }` (`game` is M7; see "The setup wizard") |
| `POST /api/events` `{ name, game? }` | host | M7: 201 `{ event }`, a new event that becomes the current one; 409 `bracket-running`; 400 `bad-request` |
| `GET /api/event/plan` | host | M7: `{ plan }`, or `{ plan: null }` when the event has none or its plan can't be read |
| `PUT /api/event/plan` `{ plan }` | host | M7: `{ plan }`; 400 `bad-request` unless `isEventPlan` accepts it |
| `GET /api/live` (WebSocket) | host or device | messages from the server, below |

A device leaves the server as `{ id, role, label, lastSeen }`, where `label` is a short name
the server gives it ("Display 1", "Sign-up 2"). An event is `{ name }` until M7, then
`{ name, game }`, where `game` is a string or null.

The host picks the role when making a code, so a TV only has to type the code. The host
password itself is never sent back. Wrong codes and wrong passwords are rate limited per
client IP in both modes (`CLAUDE.md`, rule 7), with the IP taken by rule 6. An IPv6 client
counts by its /64, so a caller can't get fresh tries by changing the end of its address.
Wrong codes are also capped across all callers (100 per 10 minutes), so a guesser with many
addresses can't search the code space; once the cap is used up, every join answers 429 until
the window ends. A right code gives back its own try on both counts and leaves the wrong ones
counted.

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
`{ type: "players" }` when the player list changes (the host page reloads it),
`{ type: "plan" }` when the event's plan changes or a new event starts (no payload: a host
screen reads the plan itself), and `{ type: "unpaired" }` just before the server closes an unpaired device's connection. A
client reconnects with a growing delay after a drop.

**The Display frame** in M3 shows the event name, live. "Up next" and the match timer have
their places on the screen but show a waiting message until M4 brings matches.

### Phone API

Planned in M6 (2026-11-14). The rules of "Devices and host API" apply: bodies are JSON, every
answer lists its fields, errors are `{ "error": code }`. The shared types are in
`packages/core/src/api.ts`, and the design is under "Player view".

| Request | Who | Answer |
|---|---|---|
| `POST /api/phone/follow` `{ handle, pin }` | anyone | 201 `{ following: [player] }` and the `cg_phone` cookie if the phone is new; 400 `refused` (the handle fails the filter) or `bad-request`; 401 `wrong-pin` (a wrong PIN, and a handle nobody has); 409 `too-many-handles`; 429 `too-many-tries` |
| `POST /api/phone/follow-code` `{ code }` | anyone | the same answer without `wrong-pin`; 404 `wrong-code` for unknown, used, unreadable, or expired; 409 `too-many-handles` before the code is spent; 429 `too-many-tries` |
| `GET /api/phone` | phone | `{ event, following, standings }`; 401 `not-following` |
| `DELETE /api/phone/follow/:playerId` | phone | `{ following }`; the last one signs the phone out; 404 `not-found` if the phone doesn't follow that player |
| `POST /api/phone/sign-out` | phone | 204, the cookie cleared, the live connection closed |
| `GET /api/phone/push` | phone | `{ publicKey: string \| null }` |
| `PUT /api/phone/push` `{ endpoint, keys: { p256dh, auth } }` | phone | 204; 409 `push-off`; 400 `bad-request` for an endpoint that isn't allowed or keys of the wrong size |
| `DELETE /api/phone/push` | phone | 204 |

A phone that follows nobody is not signed in: its first follow makes the row, and the route
sets the cookie. `GET /api/phone` is the one answer a phone gets about the competition:

```ts
interface PhoneAnswer {
  event: EventInfo | null;
  following: FollowedPlayer[];
  standings: PhoneStandings | null;    // null while the event has no bracket or groups
}
interface FollowedPlayer {
  player: Player;
  status: 'now' | 'next' | 'two-away' | 'later' | 'waiting' | 'out' | 'done' | 'not-in';
  away: number | null;     // 0 on a station; 1 first in Up next, and so on
  station: number | null;  // with `now`
  matchId: number | null;  // the match or group, so a page knows a new call from an old one
  others: Player[];        // the other players of that match or group who are known
  place: number | null;    // with `done`
}
type PhoneStandings =
  | { kind: 'bracket'; format: BracketFormat; finished: boolean; rows: StandingsRow[] }
  | { kind: 'heats'; finished: boolean; rows: HeatStandingsRow[]; finalSize: number };
```

`standings` has everyone's rows, as the Display does (Brad, 2026-11-14), and the rows are
the bracket's or the groups' own. A player leaves the server only as `{ id, handle }`
(`CLAUDE.md`, rule 1), and every schema has `additionalProperties: false`. The follow routes
answer with the players only, `{ following: [player] }`, and `POST /api/signup` and
`POST /api/signup/claim` also answer with `followCode: { code, expiresAt }` (`SignupAnswer`).

The routes marked "phone" answer 401 `not-following` to anyone who isn't a phone that follows
someone. A phone gets 401 `not-signed-in` from every host and sign-up route, and from `GET
/api/bracket` and `GET /api/heats`. `GET /api/event` and `GET /api/live` accept a phone as
well as the host and a device. The follow and follow-code routes need no cookie, and the
first one to succeed makes the phone.

A phone that already follows the player in `POST /api/phone/follow` gets 201 with its
current list and no PIN check. A merge moves every phone's follow from the merged player to
the one kept (a phone that followed both keeps one).

**Error codes** added to the list (the client turns each into words in
`packages/client/src/api/errors.ts`): `not-following` (the request needs a phone that follows
someone), `too-many-handles` (6 are followed already), and `push-off` (push isn't available
here). A wrong PIN and a limit use the codes the claim route has. On the phone route an
unknown handle is a wrong PIN.

**Live.** A phone connects to `GET /api/live` with its cookie, and the server checks the
`phones` row for as long as the connection is open, as it does for a device. It gets the
broadcasts every screen gets: `event`, `players`, `bracket`, and `heats`. These carry nothing
personal, and the page reloads `GET /api/phone` when one arrives. Signing out sends
`{ type: "unpaired" }` and closes the connection, so the page stops reconnecting. A
connection that is also the host, the laptop, or another device or phone loses only the
identity that ended and stays open; the same holds when the host unpairs a device.

**The answer cache.** A 32-player round robin takes 258 ms to rebuild (see "Brackets API"), and
30 phones that each reload on every result would block the server for about 8 seconds
(30 x 258 ms) per result. So `competition.ts` keeps the current answer of the bracket or
groups and every phone's answer is worked out from it. The cache is dropped on every save,
start, delete, rename, merge, and event change, so a phone never reads an answer older than
the last change. A write path that forgets to drop it would show stale data, so the tests
cover each path.

**Storage.** Migration 6 adds:

- `phones`: the id, the token's SHA-256 hash (`UNIQUE`), `last_seen`, and `created_at`.
  `last_seen` is refreshed whenever the phone's cookie is used, at most once a minute. A phone
  not seen for 90 days is deleted, and its follows and subscription with it.
- `phone_follows`: the phone, the player, and `created_at`. The primary key is both ids, and
  either one deleted deletes the row.
- `follow_codes`: the code (primary key), the player (deleted with the player), `created_at`,
  `expires_at`, and `used_at`. A code is spent with one `UPDATE ... RETURNING`.
- `push_subscriptions`: the phone (primary key, deleted with the phone), the endpoint
  (`UNIQUE`), `p256dh`, `auth`, and `created_at`.

The VAPID key pair is not in the database: it is the file `vapid-private-key.pem` (mode 0600)
in `DATA_DIR`, made on first use (`vapid-keys.ts`), and the VAPID subject is the setting
`COLISEUMGRID_PUSH_SUBJECT`, a `mailto:` or `https:` URL that isn't `localhost`. Without the
subject push stays off and the server warns at startup.

No handle is stored in these tables; an answer joins the current one. Foreign keys are on by
default in `node:sqlite`, checked 2026-11-14.

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

From M6 the answers of `POST /api/signup` and `POST /api/signup/claim` also carry a
`followCode` (see "Phone API"). `handle` in an answer is the normalized display form from `packages/core`. The server runs
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
client IP taken by rule 6. A wrong PIN there also counts toward the handle's phone lock, but
phone failures never lock the claim ("Player view"). Offline, a wrong PIN only costs a retry.

### Stats

Each handle keeps, across events: events played, matches won and lost, heat points, and best
finish. Season standings come later (see `ROADMAP.md`, "Later").

## 5. Formats

The setup wizard offers three cards. Each has its options under "More options" (see "The
setup wizard" in section 6).

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

Planned in M5 (2026-11-13). The same format runs racing game races and 4-player fighting game
free-for-alls: a **heat** is a group of 2 to 4 players who play together on one station, and
each finishing place earns points. On screen a heat is a "Group" (Brad, 2026-11-13), because
A fighting game has no races. For the same reason the setting reads "Games in each group" on screen
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
  and the Delaware DSEL Mario Kart 8 rules put 4 players on each console
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
  best of in a bracket. Entering every race would be 16 taps a heat. A player who didn't come is marked missing
  instead of placed (see "Waiting for a missing player").
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

A fighting game supports 2 vs 2. The data model has an entry hold one or more players from the start,
so teams can be added without a rewrite. The screens are built for single players first.

### Time estimate

Planned for M7 (Brad, 2026-11-14). The wizard shows how long the event will take and warns
when it won't fit the time the host has. It is a planning figure, not a promise. No
published average game length exists, so the defaults below are figures picked from the
sources that follow, and the host can change each one under "More options".

**Defaults** (all in the event's plan, see "The setup wizard"):

| Setting | Default | Choices |
|---|---|---|
| Minutes for one game (Fighting game, Another game) | 5 | 2, 3, 4, 5, 7, 10, 15 |
| Minutes for one race (Racing game) | 4 | 2, 3, 4, 5, 7, 10, 15 |
| Changeover minutes | 4 | 0, 2, 4, 6, 8 |
| Time you have | 3 hours | 1 to 6 hours |

**Where the figures come from.** Checked 2026-11-14.

- **A match timer is a cap, not a typical length.** A library's competition rules use a
  7-minute timer with 3 stocks, best of 3
  (<https://dallaslibrary.librarymarket.com/sites/default/files/2025-01/Smash%20Bros%20Competition%20Details.pdf>),
  the PlayVS scholastic rulebook for 2026-27 uses the same
  (<https://help.playvs.com/en/articles/4919168-playvs-scholastic-super-smash-bros-ultimate-rulebook>),
  and another library limits a game to 5 minutes
  (<https://www.wnpld.org/sites/default/files/2024-12/Smash%20Bros%20Rules.pdf>). The 5-minute
  default is that last limit.
- **Time per set.** West Games' "Tournament Bracket Calculator" (2026-08-19) plans 8 to 14
  minutes for a best of 3 and 3 to 5 minutes of setup buffer per set
  (<https://west-games.com/tournament-bracket-calculator/>). It is a commercial calculator,
  not a guide for organizers. start.gg's best-practices example uses 10 minutes per match
  (<https://help.start.gg/en/articles/13766333-online-bracket-configuration-best-practices>).
  The 4-minute changeover is the middle of that buffer.
- **Races.** A 4-race cup, with most courses 3 laps, takes "usually within the two-minute
  range" a race (<https://www.mariowiki.com/Grand_Prix>). A 96-race session ran about 4.5
  minutes a race with the menus in between, worked out from the timestamps in the article
  (<https://www.nintendolife.com/features/death-by-a-thousand-karts-can-we-race-all-96-mario-kart-8-deluxe-tracks-in-a-single-session>,
  2024-12-25). The 4-minute default sits between those two figures.

**Matches.** `n` is the number of players.

| Format | Matches |
|---|---|
| One life | n - 1, plus 1 from 4 players (the 3rd-place match) |
| Two lives | 2n - 2 to 2n - 1 (the rematch for the title is played only sometimes) |
| Everyone plays everyone | n(n - 1) / 2, up to 3 more for a tie-break; a three-way tie is 3 matches, and a bigger tie would add more, which the estimate doesn't count |
| Groups | 4 players or fewer: 1 group, the final. More: `rounds` x ceil(n / 4), plus 1 for the final, plus tie-break groups: up to 1 for 10 players or fewer, up to 3 from 11 (checked 2026-11-14 by playing 2016 runs of 5 to 32 players and 1 to 3 rounds through the engine; the 4, 3, 2, 1 table ties often, and a bigger tie needs several groups) |

**Waves.** Matches at the same time are one **wave**. A plain count of matches times minutes
divided by stations undercounts when there are several stations, because a round can't start
before the round it needs has finished: 4 players in a one-life bracket on 8 stations is 4
matches, which that count prices at half a match's time, but only 2 matches can be played
at once (round 1), then the final and the 3rd-place match, so it takes 2 waves. So the
estimate counts waves, with `s` stations, `n` players, and `live` = min(s, floor(n / 2)), the
most matches that can be played at once.

| Format | Waves (low to high) |
|---|---|
| One life, Two lives | `simulateWaves` (below) over the bracket's rounds; Two lives adds 1 at the high end for the rematch for the title |
| Everyone plays everyone | low = max(ceil(M / live), R), with M the matches without a tie-break and R = n - 1 rounds when n is even and n when n is odd; high = low + 3 for a tie-break round of 3 matches, which can't be played together |
| Groups | up to 4 players: 1 wave. More: `rounds` x ceil(ceil(n / 4) / s) + 1 for the final, plus at the high end 1 wave for 10 players or fewer, or 2 waves from 11 (3 on one station, where each tie-break group is a wave) |

**Elimination waves.** `simulateWaves` in `packages/core/src/estimate.ts` works the waves out
round by round from the engine's real round sizes (checked 2026-11-14 against
`brackets-manager` for 2 to 32 players; Two lives has the losers' rounds too). Each wave plays
up to `live` matches from the rounds that are ready, the round that became ready first going
first, as the queue does. A round is ready once every round it needs ended in an earlier wave,
so the simulation treats a round as a whole, which is slightly stricter than the real bracket,
where a match needs only its two feeders. The simple formula max(ceil(M / live), fewest rounds)
that this section first had is not used: a round with more matches than stations takes several
waves, and the formula missed 58 of 305 engine cases (12 players on 3 stations: it says 4
waves, the engine needs 6). Everyone plays everyone has no rounds to wait for, so it keeps the
simple formula; with many stations its waves can still run a few above the low end (2 or 3 were
seen), which the high end's +3 covers.

**Minutes.** One match in a bracket takes minutes per game x games played + changeover
minutes. Games played is 1 for best of 1, 2.5 for best of 3, and 4.125 for best of 5, the
expected number for evenly matched players (derived: in a best of 3, 2 games with chance 1/2
and 3 with chance 1/2; in a best of 5, 3, 4, and 5 games with chances 1/4, 3/8, and 3/8). One
group takes minutes per race x games in each group + changeover minutes. The total is waves x
minutes for one match or group, as a low end and a high end.

**What the screen shows.** The high end, rounded to the nearest 5 minutes under an hour and
the nearest 15 from an hour. In step 3 it also shows the finish time, from the laptop's clock
(`Intl.DateTimeFormat`, no network). The estimate is too long when its high end, before
rounding, is more than the hours the host has x 60. The warning never blocks **Start**.
It suggests up to two fixes, each worked out by running the estimate again with the change,
and shows the two that save the most time: add a station, pick One life, play best of 1, pick
1 vs 1 bracket, play fewer games in each group, play 1 round before the final. A fix is only
offered when it applies to the plan, such as One life for Two lives.

**The code.** `packages/core/src/estimate.ts`, pure and tested for 2 to 32 players in every
format. A server test (`packages/server/test/estimate-calibration.test.ts`) checks the waves
against the real engines. It plays a bracket out in batches (`playOutCountingBatches` in
`packages/server/test/bracket-helpers.ts`, which records a result for every match on a
station, then rebuilds once) and groups the same way (`heat-helpers.ts`), and counts the
batches. The batches must be within the estimate's [low, high] widened by max(1, 10% of
high) either way (a tolerance of ceil(10% of high) waves, at least 1), for 12 sizes from 2 to
32 players (to 12 for everyone plays everyone) on 1, 2, 3, 4, and 8 stations, with random
winners over 3 seeds, and 1 to 3 rounds for groups. Everyone plays everyone is
measured only when its ties need no more than the one tie-break round of 3 matches that the
estimate counts: a loop among 3 players that repeats, or a tie of 4 or more, needs 6 or more
tie-break matches and ran past the high end in 10 of 120 runs (2026-11-15).

**Examples.** 16 players in Two lives, best of 1, 1 station, 5 + 4 = 9 minutes a match: 30 to
31 matches in 30 to 31 waves, which is 270 to 279 minutes. The screen shows about 4 hours 45
minutes. Everyone plays everyone with 16 players is 120 matches, 123 with a tie-break, which
on one station at 9 minutes is about 18 hours 30 minutes.

## 6. Running an event

1. **Set up:** the wizard's steps 1 and 2: name and game, then how to play (see "The setup
   wizard"). The event can carry a graphic for the name tags and the TV.
2. **Sign-up:** tablets take players; the host can add players by hand.
3. **Start and play:** step 3 starts the competition. The queue sends matches to stations.
   The TV shows "Up next" and the timer. The host records each result with one tap (1 vs 1)
   or by tapping players in finishing order (heats).
4. **Finish:** final standings on the TV. Results go to each handle's stats.

### The setup wizard

Planned for M7 (Brad, 2026-11-14). The wizard replaces `StartCompetitionDialog.tsx` and the
event name box on the host screen (`/host`). A 12-year-old has to be able to run it with
three choices and no typing beyond the event name (principle 1).

**Setup mode and play mode.** The host screen is in *setup mode* while the current event has
no bracket and no groups: the wizard replaces the Event and Competition sections, and
Screens and Players stay below it. Once a competition exists it is in *play mode*, as today,
with two changes. The Event section keeps the rename box and gains **New event** (see "A new
event"). **New competition**, after a finish, opens the wizard at step 2 with **Cancel**,
because the event and its game are already set; a new competition replaces the finished one,
as it does now.

**Steps 1 and 2 come before sign-up and step 3 after it**, so the choices are kept on the
server as the event's plan (see "Storage and routes"), not in the page. A reload, or a
second laptop window, finds them.

**Nothing is lost.** Every part of the dialog is reused: `BracketOptions` is split, with its
format choices moving to the cards and the lives choice into "More options", and its best of
staying there; `GroupOptions`; the stations select; and `PlayerPicker`, with **Pick all**,
**Clear**, and "Not signed up to this event". Checked against the code on 2026-11-14.

**Step 1, "Name and game".**

- **Event name**, the only required typing, with the limits it has today (1 to 60
  characters, no control characters; `cleanEventName` in `packages/server/src/events.ts`).
  A dice button next to it fills in a catchy name, and each tap gives another.
- **The names** come from `packages/core` (`event-names.ts`): two-word names such as "Thunder
  Showdown" and "Turbo Grand Prix", and compound words, built from long word lists. The
  caller passes a seeded `RandomSource` (`CLAUDE.md`, rule 4); the host page seeds one from
  `crypto.getRandomValues` on each tap. The words match the template: fighting words for
  Fighting game, racing words for Racing game, general words for Another game. The lists hold
  no game titles, brand names, or trademarks. A test runs every name the lists can make
  through `isVulgar` (as written, and with the spaces taken out, in case a bad word spans the
  join) and checks that each name is at most 60 characters.
- **Template cards:** Fighting game, Racing game, Another game. A template only sets
  defaults. The default card is the previous event's plan, else Fighting game.

| Template | Card | Minutes for one game or race |
|---|---|---|
| Fighting game | 1 vs 1 bracket | 5 a game |
| Racing game | Races and free-for-all | 4 a race |
| Another game | 1 vs 1 bracket | 5 a game |

  Picking a different template than the saved one puts the template's defaults over every
  step 2 choice, so step 2 never shows a half-old plan. The sources for the minutes are in
  "Time estimate".
- **"What game are you playing?"**, an optional game name, cleaned like the event name
  (whitespace collapsed, trimmed, 60 characters, no control characters) and checked by the
  server. An empty one is stored as nothing. It is shown next to the event name on the TV,
  the Sign-up tablet, and the phone page, so players know what they are signing up for. It
  is stored as event data (`CLAUDE.md`: no game title lives in code), and leaving it empty is
  fine, so the check "no typing beyond its name" holds. Like the event name, it is host
  typed and not run through the handle filter.
- **Next** saves the name and game (`PUT /api/event`, extended with `game`) and the plan
  with the template's defaults (`PUT /api/event/plan`).

**Step 2, "How to play".**

- **Three cards**, as in section 5: 1 vs 1 bracket, Everyone plays everyone, and Races and
  free-for-all. Their lines are the ones the dialog has: "Players face off one on one.
  Winners move on.", "Every player plays all the others. The most wins takes 1st.", and
  "Groups of up to 4 score points by place. The top 4 play a final." (`CARD_CHOICES` in
  `wizardWords.ts`, which takes the second line from `FORMAT_CHOICES` in `bracketWords.ts`).
- **The estimate line**, "With 16 players, this takes about 2 hours", where the players
  count is a picker from 2 to 32. It starts at the number signed up when that is 2 or more,
  else 16. It is only for the estimate and is not stored. A count below the format's minimum
  (Two lives needs 3) shows the existing problem words instead of a time.
- **More options**, an MUI `Accordion` for the selected card:

| Option | Choices | Card |
|---|---|---|
| Lives | One life, Two lives | 1 vs 1 bracket |
| Best of | 1, 3, 5 | 1 vs 1 bracket, Everyone plays everyone |
| Stations | 1 to 8, fixed once started | all |
| Games in each group, Rounds before the final, points for 1st to 4th (`GroupOptions`) | 1 to 4, 1 to 3, the points table | Races and free-for-all |
| Minutes for one game (Minutes for one race with the Racing game template) | 2, 3, 4, 5, 7, 10, 15 | all |
| Changeover minutes | 0, 2, 4, 6, 8 (default 4) | all |
| Time you have | 1 to 6 hours (default 3) | all |
| Wait for a missing player | 3, 5, 10, 15 minutes (default 5) | all |

  Options the engines don't support stay out: the 3rd-place match is always on, the rematch
  for the title is always on, and the final's size is fixed at 4. The defaults for the other
  settings are the dialog's: One life, best of 1, 1 station, 1 game in each group, 2 rounds,
  4, 3, 2, 1.
- **Next** saves the plan.

**Step 3, "Start".**

- A live "12 players signed up" count, which follows the `players` live message.
- A summary line of the choices, the estimate with the finish time, and the too-long warning
  (see "Time estimate").
- **More options**, then **Change players**: the `PlayerPicker`. It starts with everyone
  signed up checked, as the dialog does.
- The existing problem words when the count can't start the format (`startProblem`,
  `groupsProblem`, and `pointsProblem`).
- **Back**, and a big **Start**, which sends the existing `POST /api/bracket` or
  `POST /api/heats`.

**A new event.** **New event** in play mode starts step 1 in new-event mode, which says
"Players sign up again for this event." `POST /api/events` `{ name, game? }` makes a new
`events` row that becomes the current event, because the current event is the newest row
(`packages/server/src/events.ts`). The new event copies the previous event's plan as its
defaults; the game is not copied. It is host only and runs on the same write chain as every
bracket and heats write, so the check and the insert can't interleave with a start. It
answers 409 `bracket-running` while a bracket or groups are running, and a finished
competition doesn't block it. Afterwards the server drops the phone answer cache, the same
as `PUT /api/event` (`onEventChanged`), and broadcasts `event`, `players`, `bracket`, and
`heats`. Players sign up again: a returning kid types their handle and PIN, and the claim
adds them to the new event (see "Who is in a bracket"). Past events stay in the database
for M10's stats, which makes the old brackets real data from M7 on.

**Storage and routes.** Migration 7 adds `events.game` (`TEXT`, null for none), `events.plan`
(`TEXT`, JSON), and the two result columns named under "Brackets API" and "Heats API". The server checks the plan at the edge with `isEventPlan` from
`packages/core` and answers 400 `bad-request` for anything else (`CLAUDE.md`, rule 2). A
stored plan that can't be read becomes null, so a hand-edited database can't break the page.
`GET /api/event` lists its fields one by one: `{ name, game }` (rule 1). `PUT /api/event`
takes `{ name, game? }`: leaving `game` out keeps the stored one, and an empty string clears
it. Leaving it out is only an option for an API caller: the rename box always sends the game
it shows, so what the host sees is what is stored. `GET` and `PUT /api/event/plan` are host
only and take `{ plan }`; a `PUT` also sends every screen a `plan` live message with no
payload, as `POST /api/events` does (a wizard open in a second host window reads the plan
again when it has no change of its own waiting to be saved). A phone and the Sign-up tablet read the game from `GET /api/event`
and the `event` live message; `GET /api/phone` carries it in its `event`. The plan is flat
and its schema is closed (`additionalProperties: false`):

```ts
interface EventPlan {
  template: 'fighting' | 'racing' | 'other';
  format: 'single' | 'double' | 'round_robin' | 'heats';
  bestOf: 1 | 3 | 5;
  races: 1 | 2 | 3 | 4;        // games in each group
  rounds: 1 | 2 | 3;           // before the final
  points: number[];            // 1st to 4th, passes isPointsTable
  stations: number;            // 1 to 8
  minutesPerGame: number;      // 2, 3, 4, 5, 7, 10, or 15
  changeoverMinutes: number;   // 0, 2, 4, 6, or 8
  hours: number;               // 1 to 6
  noShowMinutes: number;       // 3, 5, 10, or 15
}
```

The plan is the host's settings. The competition keeps its own settings, sent by `POST
/api/bracket` or `POST /api/heats` at the start, so changing the plan never changes a
running bracket's format, best of, stations, rounds, or points. The one exception is
`noShowMinutes`: the bracket and groups answers read it from the plan each time they are
built, so a change shows on the running competition at once (see "Waiting for a missing
player"). The wizard saves the plan one change after another, and **Start** waits for those
saves and sends the plan the server answered with.

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
  time for the first matches. For a tie-break match it is the later of the time the host
  pressed **Play tie-break** and the time of the result that freed the station (see "Waiting
  for a missing player"). The TV counts up from it, in the server's time. Nothing sounds or changes by
  itself; from M7 the host is prompted when the plan's wait is over (see "Waiting for a
  missing player").
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

### Waiting for a missing player

Planned for M7 (Brad, 2026-11-14), from his son's question. The host chose a prompt over an
automatic rule. Published rulesets wait 5 to 15 minutes after a call, most often 5, and
leave the decision to the organizer:

- start.gg's disqualification timer starts when the players are called, is optional, and its
  guidance is half the set time of a best of 3, or up to 10 minutes
  (<https://help.start.gg/en/articles/13766200-online-round-settings> and the best-practices
  article cited under "Time estimate").
- The Unified European Ruleset's report window is 5 to 10 minutes
  (<https://www.ssbwiki.com/Unified_European_Ruleset>).

No rule written for kids was found, so the default is 5 minutes and the host changes it
under "More options" (`noShowMinutes`: 3, 5, 10, or 15; checked 2026-11-14).

**The prompt.** A station's `calledAt` (see "Stations and the queue"; for the first matches
it is the bracket's creation time) plus `noShowMinutes` is when the wait is over. Then the
host's station card shows "Still waiting?" with two buttons, **They're here** and
**Forfeit**, and the host taps who is missing. Nothing happens by itself. The TV shows a call
line for that station while the wait is over, naming every player of the match or group,
since the TV can't know who is missing: "Zap and Kai, come to station 2!" The bracket and
heats answers carry `noShowMinutes`, read from the event's plan, so the screens agree on when
the wait is over; it is 5 when the event has no plan.

**They're here** (Brad, 2026-11-15). Without it the prompt and the call line stayed up for
the rest of every match, since only a result cleared them. **They're here** says the players
came: the prompt goes from every host screen and the call line from the TV, for that match
or group. The snackbar says "Station 2: they're here" with **Undo**, which puts the wait
back. It is stored on the server (`POST /api/bracket/arrived` takes `{ matchId, arrived }`,
and `POST /api/heats/arrived` takes `{ heatId, arrived }`; host only, so a phone, a device,
or a stranger gets 401), and each station in the answers carries `arrived`. It belongs to one
call: the table `bracket_arrivals` (or `heat_arrivals`) keeps the match and the `calledAt` it
was tapped for, so a match reopened by an older undo and called again starts a new wait. An
arrival is not a result, so no log, standing, or undo reads it. Undoing the newest result
brings the same call back with its arrival, and an undo that takes away a tie-break (or a
later round or the final of a group event) takes the arrivals of those with it, so a new one
with the same id starts fresh. It answers 409 `not-on-station` for a match that isn't on a
station and 404 `not-found` for one that doesn't exist.

**The server's clock.** `calledAt` is the server's time, so a wait or a timer that read the
laptop's, tablet's, or TV's own clock would be wrong by however far that clock is off. Every
answer that carries the bracket or the groups also carries `now`, the server's time as ISO
8601, read when the answer is sent and never kept with a cached answer. The client keeps the
difference to its own clock (the middle of the request to `now`) and the station timers, the
wait for a missing player, and the TV's call line all count in server time. There is no live
hello message, so each reload of the bracket or the groups also refreshes the offset.

**A tie-break's call time.** A tie-break match or group is called when the host presses
**Play tie-break**, not at the time of the last result before it, so its wait starts when the
players are told. The tie-break records hold that time (`at`, set by the route from the
server's clock); a station it fills is called at the later of that time and the time of the
result that freed the station, and a tie-break stored before migration 8 has no time and is
called at the last result's time, as before. Undoing the result a tie-break was made after
takes the tie-break and its time away, so the bracket is exactly what it was.

**In a bracket**, a forfeit is recorded as an ordinary result for the player who showed up,
with `forfeit: true` on the result record. The flag is copied through the result log and its
replay, so undo, standings, and ties work as they do for any result. The bracket view and the
results list mark the match "Forfeit". If both players are missing, the host forfeits one,
and the other is recorded as the winner and moves on to their next match; the same wait
applies there if they still haven't come.

**In groups**, the host records the group as today and marks the players who are missing. A
missing player scores 0 points (Brad, 2026-11-14), the others take places in the order they
finished and score for those places, and the group counts as played for everyone, so
everyone still plays the same number of groups. At least one player has to be there. A
missing player in the final or a tie-break group takes the places after those who played, in
qualifying order (seeding order when level), so places 1 to 3 stay unique.

**Undo** works as for any result: the forfeit or the missing marks are part of the result in
the log, and undoing it restores the bracket or heat exactly (`CLAUDE.md`, rule 5). The late
sign-up rules are unaffected.

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
keeps its row, with the step and time of the undo. Migration 7 (M7) adds `forfeit` (0 or 1,
default 0): the result is for the player who came, recorded because the other didn't (see
"Waiting for a missing player"). Migration 8 adds `at` to `bracket_tie_breaks` (when the host
pressed Play tie-break; null on an older row) and the table `bracket_arrivals` (the bracket,
the match, and the `calledAt` it was tapped for). No handle is stored; an answer joins the current one. The server rebuilds the library's state on its
in-memory store (`brackets-memory-db`) by creating the stage and replaying the log. It checks that each logged match is ready and holds the same two players.
A tie-break match is stored by the server with the step at which it was made, and its
result goes in the same log. Replay of 32 players took 13 ms in two lives (63 results) and
258 ms in a round robin (496 results), so there is no cache in M4; M6 adds one (see "Phone API").

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
| `POST /api/bracket/results` `{ matchId, winnerId, forfeit? }` | host | `{ bracket, resultId }`; 409 `not-on-station`; 400 `bad-request` if the winner isn't in the match; 404 `not-found` for a match that isn't there |
| `POST /api/bracket/undo` `{ resultId }` | host | `{ bracket }`; 409 `undo-later-first`, or `nothing-to-undo` for a result not in the log or already undone |
| `POST /api/bracket/players` `{ playerId }` | host | `{ bracket }`; 409 `late-closed` or `already-in`; 404 `not-found` for a player who isn't there |
| `POST /api/bracket/tie-break` | host | `{ bracket }` with the tie-break matches made; 409 `no-tie` if the bracket answer lists no tie that still needs matches |
| `POST /api/bracket/arrived` `{ matchId, arrived }` | host | `{ bracket }`; 409 `not-on-station`; 404 `not-found` for a match that isn't there |
| `DELETE /api/bracket` | host | 204; the host screen asks first, since it can't be undone |
| `GET /api/event/players` | host | `{ playerIds }`: the players signed up to the current event |

`forfeit` (M7) is optional and false when left out. When true, `winnerId` is the player who
came, and the result is logged and undone like any other.

Every bracket answer also carries `now`, the server's time (see "Waiting for a missing
player"): `{ bracket, now }`, and `{ bracket, resultId, now }` for a result. It sits beside the
bracket, not inside it, because the phone answer cache keeps a bracket and would keep a
stale time with it.

The five `POST` routes under `/api/bracket/` answer 404 `no-bracket` when the event has no
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
  noShowMinutes: number;    // M7: when a station's wait is over (see "Waiting for a missing player")
  stations: { number: number; match: BracketMatch | null; calledAt: string | null; arrived: boolean }[];
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
  forfeit: boolean;         // M7: the winner won because the other didn't come
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
"Add player" fill it, and the start dialog (from M7, step 3 of the wizard) pre-checks the event's players. A player who
signs up before the host has named an event goes into one the server makes then, named
"ColiseumGrid" (what the Display shows with no event), and the host can rename it. Starting a
bracket adds every player in it to the event, so a player picked from "Not signed up to this
event" is in the event from then on, and so does adding a late player. Merging away a player
who is in a bracket of the current event, running or finished, answers 409 `in-bracket`, so
the bracket's answer can always be made; deleting the bracket frees them. A
merge keeps the merged player's place in the event for the player kept.
That guard checks the current event only. From M7 a new event leaves the old event's bracket
in the database, so merging away a player who is in a past bracket needs care (`ROADMAP.md`,
M10).

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
  time, and `undone_step` and `undone_at` for an older undo. Migration 7 (M7) adds
  `missing`, a JSON list of player ids, null for none (see "Waiting for a missing player").
- `heat_late_joins`: the run, its position, the player, the heat, and the step.
- `heat_tie_breaks`: the run, its position, the players as JSON, and the step. Migration 8
  adds `at` (when the host pressed Play tie-break; null on an older row).
- `heat_arrivals`: the run, the heat, and the `calledAt` it was tapped for (migration 8).

Ids and times only (`CLAUDE.md`, rule 1); an answer joins the current handle.
`heat-engine.ts` follows the bracket engine: state in, state and answer out, the log made by
`logOf`, every answer a replay, no clock, no database. Rounds 2 and on, the final, and the
tie-break heats are derived on replay. A heat's id is `round * 100 + number`; tie-break heats
start at 1000 and the final is 2000.

| Request | Who | Answer |
|---|---|---|
| `GET /api/heats` | host or device | `{ heats }`, or `{ heats: null }` before any are made |
| `POST /api/heats` `{ stations, races, rounds, points, playerIds }` | host | 201 `{ heats }`; 409 `bracket-running`; 400 `too-few-players`, `too-many-players`, or `bad-request` |
| `POST /api/heats/results` `{ heatId, order, missing? }` | host | `{ heats, resultId }`; 409 `not-on-station`; 400 `bad-request` if `order` and `missing` together aren't the heat's players, each once, or if nobody is in `order`; 404 `not-found` for a heat that isn't there |
| `POST /api/heats/undo` `{ resultId }` | host | `{ heats }`; 409 `undo-later-first`, or `nothing-to-undo` for a result not in the log or already undone |
| `POST /api/heats/players` `{ playerId }` | host | `{ heats }`; 409 `late-closed` or `already-in`; 404 `not-found` for a player who isn't there |
| `POST /api/heats/tie-break` | host | `{ heats }` with the tie-break heats made; 409 `no-tie` if no tie at the cut still needs heats |
| `POST /api/heats/arrived` `{ heatId, arrived }` | host | `{ heats }`; 409 `not-on-station`; 404 `not-found` for a heat that isn't there |
| `DELETE /api/heats` | host | 204; the host screen asks first, since it can't be undone |

Every heats answer carries `now` the same way: `{ heats, now }`, and `{ heats, resultId, now }`
for a result.

The five `POST` routes under `/api/heats/` answer 404 `no-heats` when the event has no heats.
`stations` is 1 to 8, `races` 1 to 4, `rounds` 1 to 3, and `points` 4 whole numbers that pass
`isPointsTable`. `playerIds` are 2 to 32 players; with 2 to 4, `rounds` is stored as 0. `missing` (M7) is
optional and empty when left out. When it is used, `order` lists only the players who played,
1st first, and `missing` the rest; `isFinishOrder` in `packages/core/src/heats.ts` gains a
sibling that checks the two lists together. `scoreHeats` gives a missing player 0 points and
counts the heat as played for them.

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
  noShowMinutes: number;    // M7: when a station's wait is over
  round: number | null;     // the qualifying round being played; null for tie-breaks and the final
  stations: { number: number; heat: Heat | null; calledAt: string | null; arrived: boolean }[];
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
  order: Player[] | null;   // the finishing order of those who played, once recorded
  missing: Player[];        // M7: players who didn't come; empty when none or before a result
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

Planned in M8 (2026-11-15). Brad's decisions that day: the host prints every new tag with
one tap, with a reprint on each player; each event can have its own graphic, shown on the
tags and the TV; the PIN waits in a print queue until its tag prints; a thermal label printer
comes first, with sheet labels later.

- Printed through the browser's print dialog, so any printer with an operating system
  driver works. Label sizes are CSS `@page` presets.
- A tag has the event graphic, the handle in large type, the event name, and the PIN small
  in a corner.

### The printer

The first printer is a Brother QL-800 with DK-11202 labels, 62 by 100 mm. Brad hasn't bought
it yet (2026-11-15). The reasons, from the driver files themselves:

- Brother's Linux driver, `ql800pdrv-3.1.5-0.i386.rpm` from
  [download.brother.com](https://download.brother.com/welcome/dlfp100336/ql800pdrv-3.1.5-0.i386.rpm),
  lists `62x100` as a paper size in its PPD (`PaperDimension` 175.68 by 282.96 points), with an
  imageable area inset 4.32 points at the left and 8.4 at the bottom. The default size is
  `29x90`, so the host sets 62x100 as the printer's default once. Despite the file name, it
  ships a 64-bit `x86_64` filter that links only to `libc`, so Fedora needs no 32-bit
  libraries, only Perl for the wrapper scripts (inspected 2026-11-15). Fedora's
  `ptouch-driver` package is the fallback.
- DK labels have no chip, so any DK-11202 roll works. Brother lists the QL-800 at $124.99,
  USB only ([brother-usa.com](https://www.brother-usa.com/products/ql800), 2026-11-15).
- The DYMO LabelWriter 450 driver (Fedora `dymo-cups-drivers`) lists the 30857 badge label as
  `w167h288.2`, 166.56 by 288 points. The LabelWriter 550 needs DYMO's own labels with a
  recognition chip, by a reseller's account, not DYMO's
  ([LabelValue](https://www.labelvalue.com/blog/what-labels-can-i-use-with-the-dymo-550-series-printers)).
- Unverified: whether the Windows drivers offer these sizes in the browser's dialog. Brad's
  play-test checks it.

**How Chrome treats the page size.** Read in Chromium's
[`print_render_frame_helper.cc`](https://github.com/chromium/chromium/blob/main/components/printing/renderer/print_render_frame_helper.cc)
(2026-11-15): with the dialog's Margins on "Default", Chrome lays the page out at the CSS
`@page` size. Any other Margins choice ignores the CSS size (`ShouldIgnoreCssPageSize`). The
default scaling then centres and shrinks the page to the paper picked in the dialog. Chrome
doesn't pick the paper to match the CSS size, as far as the source shows, so the printer's
default paper size has to be the label. Firefox honors `@page` size in print preview from
version 112 ([bug 1793220](https://bugzilla.mozilla.org/show_bug.cgi?id=1793220)); its
scaling when the page is larger than the paper is an open bug
([1763030](https://bugzilla.mozilla.org/show_bug.cgi?id=1763030)).

### Label sizes

| Preset | Page (`@page size`) | For |
|---|---|---|
| 62 x 100 mm (the default) | `62mm 100mm` | Brother DK-11202 |
| 2-1/4 x 4 in | `58.76mm 101.6mm` (the PPD's 166.56 by 288 points) | DYMO 30857 |
| Custom | the width and height the host types, 25 to 150 mm each | any other label |

A thermal label runs through the printer narrow side first, so the page is taller than it
is wide. The tag is drawn wide (100 by 62 mm) and turned a quarter turn to fit the page, so
it reads across when worn. Every preset keeps its text and graphic 3 mm inside the edge,
clear of the imageable area insets. `@page { margin: 0 }` keeps Chrome's header and footer
off the page ([Chrome blog](https://developer.chrome.com/blog/print-margins)). The preset
choice is a per-laptop setting kept in the browser, because it follows the printer, not the
event. Badge sheets for an ordinary printer come later (`ROADMAP.md`, "Later").

### The tag

- The handle is the largest thing on the tag, on one line across the whole width inside the
  safe edge, sized to fit: up to 72 points, and down to 28. 16 ordinary characters
  (`HANDLE_MAX`) fit across 94 mm at 28 points; 16 capital M and W do not (measured 2026-11-15:
  they need about 18 points), so a handle that needs less than 28 keeps shrinking, to a floor
  of 12, rather than cross the edge.
- The event graphic sits at the left of the row under the handle, up to a third of the width,
  kept in its own proportions. The row takes 40% of the height inside the safe edge.
- The event name and the game name are small beside it, in the middle of that row.
- The PIN is small in a corner as its four digits alone, "4821", with no "PIN" word (Brad,
  2026-11-15), so it can be read up close and not across the room. A tag with no PIN to
  print leaves the corner empty.
- Black on white, so a one-color printer prints it as designed. The graphic prints as the
  printer's driver renders it.

### The print queue

The server stores only a hash of each PIN (`pin_hash`), so it can print a PIN only at the
moments it sees one in plain form. A 4-digit PIN has 10,000 values, so its hash can be
reversed offline in moments; the protection is the limit on wrong tries. A short-lived plain
PIN therefore adds little risk (Brad's decision, 2026-11-15).

- **What queues a tag.** A sign-up, a claim on the Sign-up screen (a returning player signs
  in to a new event), a host-added player, and a host PIN reset each queue the player's tag
  with the plain PIN. **Reprint** queues it with no PIN. A player has at most one queued tag;
  a newer one replaces it, keeping the newest PIN.
- **Leaving the queue.** After the print dialog closes, the host page asks "Did all 5 tags
  print?" A browser can't tell a printed page from a cancelled one (`afterprint` fires either
  way), so the host answers. **Yes** deletes those tags and their PINs. **No** keeps them for
  another try. Each queued tag has a `version` that goes up every time it is queued again (a
  new PIN, a claim, a reprint), taken from a counter that only grows. The host sends the
  `playerId` and `version` of each tag it printed, and the server deletes a tag only if both
  still match, so a tag queued again while the dialog was open stays, with its new PIN.
- **The 12-hour limit.** A PIN still queued 12 hours after it was stored is wiped, and its tag
  prints with no PIN. The server checks at startup and every hour, beside the phone purge
  (`phone-purge.ts`, which runs daily).
- A merged or deleted player's tag leaves the queue. A new event empties it.
- The queue is never sent to a phone or a Sign-up device.

### The event graphic

- **Upload.** The host picks a PNG, JPEG, or WebP. The server takes it as a raw body of up to
  2 MB with its type in `Content-Type`, and refuses it unless the file's first bytes match
  that type, and its width and height, read from the file's own header, are each 16 to 4000
  pixels. SVG is refused: an SVG opened at its own address can run script, and the limits on
  script apply only when it's shown as an image
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image)).
- **Reading the size.** PNG: the signature, then the `IHDR` width and height at bytes 16 and
  20 ([PNG spec](https://www.w3.org/TR/png/)). WebP: `RIFF` and `WEBP`, then the `VP8X`,
  `VP8`, or `VP8L` chunk ([WebP container](https://developers.google.com/speed/webp/docs/riff_container)).
  JPEG: `FF D8`, then the first start-of-frame marker. The VP8, VP8L, and JPEG layouts are
  read from RFC 6386, the WebP lossless spec, and ITU-T T.81 before the parser is written,
  and cited in it.
- **Storing.** The file goes in `DATA_DIR/graphics` under a random name the server makes. The
  event keeps the name, type, width, and height. A new event keeps the last event's graphic.
  Only the current event's graphic is ever shown, so when it is replaced or removed the file is
  deleted and past events forget it. A file is also deleted if its write or its database
  change fails, and at startup the server deletes files in the folder that no event names
  (only names of the form it makes itself).
- **Serving.** `GET /api/event/graphic` answers with the stored type, `X-Content-Type-Options:
  nosniff`, and `Content-Security-Policy: default-src 'none'; sandbox`, for the host and paired
  devices, and `Cross-Origin-Resource-Policy: same-origin`. The page shows it only through
  `<img>`.
- **Not re-encoded.** The OWASP
  [File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
  recommends re-encoding images. That needs an image library, and a native one breaks the
  portable bundle (section 8). Only the host can upload, the type is checked, and the headers
  above keep a browser from running the file, so the risk is accepted.
- **On the TV.** The Display screen shows it beside the event name.

### Name tags API

| Request | Who | Answer |
|---|---|---|
| `PUT /api/event/graphic` (raw image body) | host | `{ event }`; 400 `bad-image` when the bytes don't match the type, `bad-size` when a side is 1 to 15 or over 4000 pixels (a side of 0 isn't a valid image, so it is `bad-image`); 413 `too-large`; 415 `bad-type` |
| `DELETE /api/event/graphic` | host | `{ event }` |
| `GET /api/event/graphic` | host or paired device | the image; 404 when there's none |
| `GET /api/tags` | host | `{ tags: [{ playerId, handle, pin, version }] }`, `pin` a string or null, sorted by handle; `Cache-Control: no-store`, because it holds plain PINs |
| `POST /api/tags` `{ playerId }` | host | 201 `{ tag }`, a reprint; it keeps a PIN still waiting to print, and otherwise has none; 404 |
| `POST /api/tags/printed` `{ tags: [{ playerId, version }] }` (up to 1000) | host | 204; each tag whose id and version both match is deleted with its PIN, and any other stays |

An event becomes `{ name, game, graphic }`, where `graphic` is `{ width, height, version }`
or null, and `version` changes with each upload so the page reloads the file. Uploading or
removing the graphic broadcasts `event`. A change to the queue broadcasts `{ type: "tags" }`
with no payload, to host screens only.

## 8. Deployment

### Online: Docker image

- `ghcr.io/bradbrownjr/coliseumgrid`: the server and the built client in one image, with
  a `/data` volume for the database and uploaded graphics. Same pattern as Pattern Break's
  `Dockerfile` and `docker.yml` workflow.
- Runs behind a reverse proxy that provides HTTPS. The proxy must accept 2 MB request bodies
  for the graphic upload: nginx's `client_max_body_size` defaults to 1m and answers 413 above
  it ([nginx](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)).
- `COLISEUMGRID_MODE=online` turns off the `localhost` host sign-in and turns on rate limits.
- The client IP for rate limits is the last `X-Forwarded-For` entry, and only when the
  direct peer is the proxy. The first entry is set by the caller and can't be trusted (the
  lesson from MEPN's `get_client_ip`).

### Offline: portable bundle

- A download for Windows x64 and Linux x64 (Fedora), built in CI and attached to each GitHub
  release: the Node runtime, the built app, and a launcher that starts the server and opens
  the host screen.
- Node's single executable applications feature would make this one file, but its Node
  26.13.1 docs mark it "Active development" (checked 2026-11-18). The bundle ships the Node
  runtime beside the app until that changes.
- The database is `node:sqlite`, built into Node, so the bundle has no native modules to
  build for each operating system. Its Node 26.13.1 docs mark it "Release candidate"
  (checked 2026-11-18). The fallback is `better-sqlite3`.
- The data lives in the user's own folder, not in the bundle, so unzipping a new version
  keeps every event: `%LOCALAPPDATA%\ColiseumGrid` on Windows and `~/.coliseumgrid` on Linux
  (Brad, 2026-11-18). The launcher sets `DATA_DIR` to it and prints the path.
- The launcher uses port 3000, or the next free port when 3000 is taken. When ColiseumGrid is
  already running, it opens the host screen instead of starting a second server.
- Windows Firewall asks to allow the server on private networks the first time it runs.
- On Fedora, Podman can run the Docker image instead.

### The TV

- A TV stick or a small PC opens the display page in a browser. Android TV devices usually
  don't include a full web browser, so one is installed from the Play Store.
- The page can't keep the TV awake on a local `http` address: the Screen Wake Lock API needs
  a secure context (`https` or `localhost`). The TV device's own sleep and screensaver
  settings are turned off instead. Online over `https`, the page holds a wake lock.

## 9. Tech stack

Versions checked 2026-11-18 at the start of M9. Pin exact versions in the lockfile; recheck at the start of each
milestone.

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 26 LTS (26.13.1) | Runs TypeScript directly (type stripping), as in Pattern Break |
| Package manager | pnpm 12.21.0 | Workspaces: `core`, `server`, `client` |
| Language | TypeScript 7.0.2, strict | `erasableSyntaxOnly` on, so Node can run every file |
| Lint | Oxlint 1.94.0 | TypeScript 7 has no compiler API yet, so no typescript-eslint |
| Tests | Vitest 5.1.0; Playwright 1.65.1 | Playwright for screen tests and screenshots |
| Server | Fastify 5.12.8 | With `@fastify/websocket` 11.3.7, `@fastify/static` 10.1.11, `@fastify/rate-limit` 11.2.2 |
| Database | `node:sqlite` | See section 8 |
| Brackets | `brackets-manager` 1.11.1, `brackets-memory-db` 1.0.6, `brackets-model` 1.7.0 | Checked 2026-11-13. Manager: MIT, released 2026-09-20. Memory store: ISC, released 2026-05-16, the library's in-memory database that the replay rebuilds on. Model: ISC, released 2026-05-16, the library's own dependency for its types. In `packages/server` only (see Packages) |
| Client build | Vite 8.3.8, `@vitejs/plugin-react` 6.3.0 | |
| UI | React 19.3.1, MUI (Material UI) 9.5.0, `@mui/icons-material` 9.5.0, React Router 8.5.1 | MUI was Brad's choice (2026-11-12) |
| Styling engine | `@emotion/react` 11.14.0, `@emotion/styled` 11.14.1 | Peer dependencies of MUI 9.5.0 |
| Fonts | `@fontsource/roboto` 5.3.0 | Bundled for offline use |
| QR codes | `lean-qr` 2.7.4 | MIT, no dependencies, SVG output through `lean-qr/extras/svg`; released 2026-09-07. Replaces `qrcode`, whose last release was 2024-08-05. Its code makes no network requests (checked 2026-11-12) |

**Known advisory.** `brackets-manager` 1.11.1, still the latest release (checked 2026-11-18),
depends on `uuid ^9.0.0`, which has a medium advisory, GHSA-w5hq-g745-h8pq
(<https://github.com/advisories/GHSA-w5hq-g745-h8pq>): the v3, v5, and v6 functions
misbehave when given an output buffer. The library calls only `v4`. The advisory lists the
fixes as uuid 11.1.1, 12.0.1, and 13.0.1; no uuid 9 patch is listed. Without a fix, `pnpm
audit --audit-level high` still passes, because the advisory is medium. `pnpm-workspace.yaml`
sets a pnpm `overrides` entry (<https://pnpm.io/settings#overrides>) that moves the library
to uuid 14.0.3; the bracket tests pass and `pnpm audit` reports no vulnerabilities.

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
