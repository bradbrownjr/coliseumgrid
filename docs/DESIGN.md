# UI design reference

Read this before adding or changing anything on a screen. The writing rules for screen text
are in [`DOC-STYLE.md`](DOC-STYLE.md). Several rules here are carried over from ECTLogger's
`docs/DESIGN.md`, which is built on the same UI library.

## The library

- **MUI (Material UI)** for every control (Brad, 2026-11-12). Don't build a control by hand
  when MUI has one.
- **Theme tokens only.** Colors, spacing, type sizes, and corner radii come from the MUI
  theme (`theme.palette`, `theme.spacing`, `theme.typography`, `theme.shape`). No hex values
  or pixel sizes in a screen's code. A value the theme doesn't have is added to the theme
  first.
- **Light and dark.** Every screen works in both. Check both before shipping a change.

## Colors

The palette is red and black, in light and dark modes (Brad, 2026-11-12). The values live in
[`packages/client/src/theme/palette.ts`](../packages/client/src/theme/palette.ts), which the
theme imports; `node tools/check-palette.ts` imports the same file and checks the contrast. The table below is the same data.

| Token | Light | Dark |
|---|---|---|
| `primary.main` | `#B80F2A` | `#B80F2A` |
| `primary.light` | `#E03A50` | `#FF6060` |
| `primary.dark` | `#7F0A1D` | `#8A0A1F` |
| `primary.contrastText` | `#FFFFFF` | `#FFFFFF` |
| `secondary.main` | `#1C1717` | `#EDE6E6` |
| `secondary.light` | `#3D3434` | `#FFFFFF` |
| `secondary.dark` | `#000000` | `#BFB5B5` |
| `secondary.contrastText` | `#FFFFFF` | `#000000` |
| `error.main` | `#A3166F` | `#FF7AC6` |
| `error.light` | `#C9408F` | `#FFA3D8` |
| `error.dark` | `#700C4C` | `#E865B3` |
| `error.contrastText` | `#FFFFFF` | `#000000` |
| `warning.main` | `#A64200` | `#FF9A3D` |
| `warning.light` | `#D06018` | `#FFB870` |
| `warning.dark` | `#7A3000` | `#D9740F` |
| `warning.contrastText` | `#FFFFFF` | `#000000` |
| `info.main` | `#0B5FB8` | `#5CB8FF` |
| `info.light` | `#3A82D1` | `#8FCFFF` |
| `info.dark` | `#074384` | `#2E8FDB` |
| `info.contrastText` | `#FFFFFF` | `#000000` |
| `success.main` | `#17703A` | `#4CD27A` |
| `success.light` | `#3E9A5A` | `#7FE3A0` |
| `success.dark` | `#0F5028` | `#26A653` |
| `success.contrastText` | `#FFFFFF` | `#000000` |
| `win.main` | `#8A6100` | `#FFC93C` |
| `win.contrastText` | `#FFFFFF` | `#000000` |
| `loss.main` | `#6B6262` | `#8C8282` |
| `loss.contrastText` | `#FFFFFF` | `#000000` |
| `upNext.main` | `#0B5FB8` | `#5CB8FF` |
| `upNext.contrastText` | `#FFFFFF` | `#000000` |
| `background.default` | `#F4F0EF` | `#0D0A0A` |
| `background.paper` | `#FFFFFF` | `#1C1515` |
| `text.primary` | `#1A1414` | `#F7F2F2` |
| `text.secondary` | `#574B4B` | `#BDB0B0` |
| `divider` | `#D6CBCA` | `#3A2F2F` |
| `focusRing` | `#0B5FB8` | `#FFC93C` |

### Rules

- **Primary is crimson `#B80F2A` in both modes**, with white text on it.
- **In dark mode, crimson is a fill only**, behind a control that has a text label. Red text,
  outlines, links, icons, and selected states use `primary.light` (`#FF6060`).
- **Dark mode never shows a selected or active state by a crimson fill alone.** Add a
  `primary.light` outline, indicator, or icon.
- **Contained buttons in dark mode have no extra border** (Brad, 2026-11-12). The text label
  identifies the button.
- **Error is magenta, not red**, so it stays distinct from the crimson brand.
- **Win is gold and loss is gray, each with an icon or the word** ("Winner", "Out"). Never
  red against green.
- **Up next is blue.**
- **The focus ring is blue in light mode and gold in dark mode**, drawn with an outline
  offset so a strip of page background separates it from a filled button.
- **Every color sets its `contrastText`.** MUI's default `contrastThreshold` is 3, which is
  below the 4.5:1 text minimum.
- **Dark-mode overrides.** The theme sets `primary.light` for the text, outline, and
  selected states of `MuiButton` (text and outlined), `MuiLink`, `MuiIconButton`, `MuiTab`
  (selected text and indicator), `MuiCheckbox`, `MuiRadio`, and `MuiSwitch` (checked),
  `MuiChip` (outlined), `MuiOutlinedInput` and `MuiInputLabel` (focused), and `MuiStepIcon`
  (the active and completed steps in `primary.light`, with the number in `background.default`
  so it reads on the lighter red). A selected
  `MuiToggleButton` gets the same, with a `primary.light` border.
- **The TV route is always dark.** See `DEVELOPMENT.md`, "Theme".

### Why

- **Magenta error.** An error in red is hard to tell from the crimson brand color, and a red
  error next to a green success fails for red-green color blindness. Magenta keeps its
  distance from crimson under simulated protanopia and deuteranopia (the script reports the
  CIE76 color difference).
- **Red text in dark mode.** Crimson on the dark background (`#0D0A0A`) is 2.95:1, under the
  4.5:1 that WCAG 2.2 success criterion 1.4.3 asks for text
  (<https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>). `primary.light`
  passes. Crimson stays as a fill because success criterion 1.4.11 asks 3:1 for a control's
  boundary, but its Understanding page says a control identified by its text label needs no
  such boundary (<https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>).

### What the check covers

`tools/check-palette.ts` computes WCAG contrast for text pairs (4.5:1) and fills and the
focus ring (3:1), as seen normally and under simulated protanopia and deuteranopia. The
simulation uses the matrices from Machado, Oliveira, and Fernandes (2009)
(<https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html>). It
applies them in linear RGB, which follows DaltonLens
(<https://daltonlens.org/opensource-cvd-simulation/>); the paper's text doesn't confirm that
choice, so it is unverified. The script can't judge a TV or projector washed out by room
light. `PLAYTEST.md` checks that on the real hardware.

## Core principles

### Symmetry and uniformity

The same control looks and acts the same everywhere: same icon, same label, same color, same
place. A "Next match" button on the host screen and on the queue panel are one component.

### Fixed answers use a picker, never free text

A field with a fixed set of answers (format, best-of, heat size, label size) is a select,
radio group, or toggle buttons. Free text is only for event names, game names, and handles.

### Phone width

Every screen and dialog works at 320 CSS pixels wide with no sideways scrolling and nothing
cut off: WCAG 2.2 success criterion 1.4.10, Reflow
(<https://www.w3.org/WAI/WCAG22/Understanding/reflow.html>). Hosts and players use phones as
well as laptops and tablets (Brad, 2026-11-13). Sizes that matter on a big screen, like the
PIN digits, scale down with the theme's breakpoints instead of overflowing, and rows of
buttons wrap or fold into a menu. Check each screen at 320 and 412 pixels wide as well as at
tablet and laptop sizes.

### Kid-sized targets

Every control a player or host taps is at least 44 by 44 CSS pixels: WCAG 2.2's enhanced
target size, success criterion 2.5.5 (<https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html>).
The Sign-up keypad and the host's result buttons are larger.

### Color is never the only signal

A winner, a loss, or a player's status is shown with text or an icon as well as color (WCAG
2.2 success criterion 1.4.1, Use of Color). Text meets 4.5:1 contrast (success criterion
1.4.3, Contrast (Minimum)).

### Undo, not "Are you sure?"

Recording a result never asks for confirmation. It shows a snackbar with **Undo**. A
confirmation dialog is only for actions that can't be undone, like deleting a bracket or groups.

## The screens

### Host (laptop)

- The setup wizard has three steps: name and game, how to play, start. Defaults are filled
  in; the rest is under "More options". Its rules are under "Setup wizard" below.
- During play, the queue is the main view: each station's current match, "Up next", and
  one-tap result buttons.
- A station card has one large button per player, reading "<handle> won". A tap records that
  player as the winner of the whole match, whatever the best-of label says.
- A tap shows "<handle> won" in the snackbar with **Undo**. Every recorded result also has its
  own **Undo** in the Results list, newest first.
- The host screen has a setup mode and a play mode (see "Setup wizard"). The **Competition**
  section runs one bracket or one set of groups. Once a competition has finished, **New
  competition** opens the wizard at step 2.
- **Delete bracket** or **Delete groups** asks first, since it can't be undone. Results don't ask.
- While a tie is open, **Play tie-break** starts its matches. While late sign-up is open,
  **Add to bracket** (or **Add to group**, when the event runs groups) is in a player's menu.
- Groups add **Games in each group** (1 to 4; a game is a race or a match), **Rounds before
  the final** (1 to 3, or none with 2 to 4 players), and the points for 1st to 4th. **Use 4,
  3, 2, 1** appears once the points change. They sit under "More options" in the wizard.
- When a station's wait for a missing player is over, its card says "Still waiting?" and
  has two buttons, **They're here** and **Forfeit**, on a match and on a group (see "Setup
  wizard", "Forfeit"). Both are outlined buttons in the alert's text color,
  **They're here** with a check icon, and they wrap onto two lines when the card is narrow. A tap removes the
  prompt from every host screen and the call line from the TV. The snackbar says "Station 2:
  they're here" with **Undo**, which brings the prompt back. A station whose match or group
  is re-called after an older undo shows the prompt again when its wait is over.
- A group's station card shows its title, its players, a timer, and one **Record result**
  button. The record panel is centered and asks "Who came 1st?", then 2nd, and so on. The
  last player is filled in. **Start over** clears the taps. **Save** turns on once the order
  is complete. If an Undo takes the open group off its station, the panel closes and the
  snackbar says "That group isn't on a station anymore."
- Saving shows "Saved: Round 1, group 3" in the snackbar, with **Undo**. The Results list has
  its own **Undo** for every result, newest first.
- The standings show points and groups played, with the line "Top 4 go to the final". A tie
  across that line gets a banner, worded by what is at stake: "Zap, Jett, Dash, and Jinx are
  tied. 2 of them go to the final. Tie-break group coming up." It comes with **Play tie-break**.

### Setup wizard

Planned for M7 (Brad, 2026-11-14). The design is in `PLAN.md`, "The setup wizard", and the
numbers on its screens come from "Time estimate".

- **Three steps** in an MUI `Stepper` with the labels "Name and game", "How to play", and
  "Start". The labels sit under the step numbers and wrap, so they fit at 320 pixels. **Next**
  is the main button, **Back** is plain, and **Start** is large.
- **Setup mode and play mode.** In setup mode the wizard replaces the Event and Competition
  sections; Screens and Players stay below it. In play mode the Event section keeps the
  rename box and adds **New event**. **New competition** opens the wizard at step 2 with
  **Cancel**.
- **Step 1.** The "Event name" field has a dice icon button at its end, labeled "Pick a name
  for me". "What game are you playing?" is a text field below it, with the helper "You can
  leave this empty." Under them, three cards in the style of the format cards: Fighting
  game, Racing game, and Another game. Each card's line says its defaults, built from the
  same constants the plan uses. In new-event mode the step says "Players sign up again for
  this event."
- **Step 2.** Three cards: "1 vs 1 bracket", "Everyone plays everyone", and "Races and
  free-for-all", with the lines the start dialog had. Under them one line, "With 16 players,
  this takes about 2 hours", where the number of players is a select from 2 to 32. Under that,
  an MUI `Accordion` titled "More options" for the selected card, holding the labels in
  `PLAN.md`'s table: **Lives** (One life, Two lives), **Best of**, **Stations**, **Games in
  each group**, **Rounds before the final**, the points, **Minutes for one game** (**Minutes
  for one race** with the Racing game template), **Changeover minutes**, **Time you have**,
  and **Wait for a missing player**. A picker's choices are listed in the plan; each is a
  select or toggle buttons, never free text.
- **The too-long warning** is an MUI `Alert` with a warning icon and words, never color
  alone: "That is longer than the 3 hours you have." Under it, up to two fixes as buttons
  that apply the change at once: "Add a station", "Pick One life", "Play best of 1", "Pick 1
  vs 1 bracket", "Play fewer games in each group", "Play 1 round before the final". It never
  disables **Start** or **Next**.
- **Step 3.** The heading reads "12 players signed up" and changes as players sign up. Under
  it, the summary line, the estimate with its finish time ("Done around 8:15 PM"), and the
  warning if there is one. "More options" holds **Change players**, which opens the player
  picker with **Pick all**, **Clear**, and "Not signed up to this event". The problem words
  show above **Start**.
- **Words.** "1 vs 1 bracket" and the other card names follow "Tournament words on screen".
  Screen text for the wizard is written for a 12-year-old: a question or a label, never a
  paragraph.
- **Forfeit.** **Forfeit** on a match opens a centered panel, "Who is missing?", with one
  large button for each player. A tap records the other player as the winner. The snackbar
  says "Zap forfeited. Kai wins." with **Undo**; there is no confirmation. The panel also
  says "If both are missing, pick one. The other moves on." On a group, **Forfeit** opens the
  same panel with a toggle for each player, then the usual "Who came 1st?" for those who are
  there. A toggle that isn't selected keeps the text color, so it doesn't read as switched
  off; a selected one is the primary color. The bracket view and the results list mark a
  forfeited match with the word "Forfeit", and a missing player in a group's result reads
  "Zap: Missing, 0 points" in a qualifying group and just "Zap: Missing" in a tie-break
  group or the final, where there are no points to score.
- **The TV call line.** While a station's wait is over, its card on the TV adds a line in
  large type: "Zap and Kai, come to station 2!" It clears when the result is recorded or the
  host taps **They're here**.
- **Step 3 while the players load.** The count isn't known yet, so the count, summary, and
  estimate wait, and **Start** is off with the line "Getting the players." and no problem
  words; once the count is known **Start** turns
  on, and if it stays off, the reason shows above it.
- **New event** is off while a bracket or groups are being played, with the line "Finish or
  delete the bracket first." (or "groups") under it. Opening the wizard never hides a running
  competition's station cards.
- **A refused game name** shows under the game field and a refused event name under the name
  field.

### Sign-up (tablet)

- One task per screen: handle, then PIN, then done.
- The event name is at the top, with the game's name under it when the host typed one, so a
  player knows what they are signing up for.
- Entry panels (the handle field, the PIN keypad) are centered on the screen (Brad,
  2026-11-12).
- The on-screen keypad for the PIN is large. The suggested PIN is already in the field with
  **Keep** as the main button.
- A refused handle says what to do next ("Pick another handle"), never why in detail.

### Display (TV)

- Read from across a room, with no input. Large type, high contrast, nothing that needs a
  hover or a click.
- Always dark, whatever color mode the host picks.
- The event name is the title, with the game's name under it in smaller type when the host
  typed one. The phone page header shows both the same way.
- Nothing scrolls on a TV. From a tablet up, the page is one screen tall and hides overflow.
  A phone stacks the parts and scrolls.
- During play, the stations and "Up next" sit on the left, and the bracket or the standings
  on the right. Stations are one column up to four, and two columns from five.
- Bracket columns start at the earliest round with an unfinished match and show the two
  after it. When every round is finished, the last round shows. A round with more than 8
  matches wraps into a second column.
- Type sizes follow how many cards stack on screen (`DENSITY` in `pages/display/model.ts`).
  The rows are measured fits, not a published minimum: 32 players in the first round and in
  two lives at 1920 by 1080, and the laptop rows at 1366 by 768. The real TV test is in
  `PLAYTEST.md`.
- Round robin shows a standings table, split into two side-by-side tables past 16 rows.
- Two lives has the sections "No losses" (the winners' side), "One life left" (the losers'
  side), and "Final". With a rematch, the first final is headed "First match" and the rematch
  "Rematch for the title". A beaten player reads "One life left" or "Out".
- Single elimination has "Round n", then "Semi-finals" and "Final", with the "3rd place match"
  under the final.
- A tie shows as a banner: "Tie for 1st: Zap and Kai. Tie-break coming up."
- A finished bracket shows the final standings, with the podium large.
- **Groups.** The stations and "Up next" stay on the left. A station card shows the group's
  title ("Group 2", "Final", or "Tie-break group") and its handles. The right side holds the
  tie banner, then the standings, or the final.
- Stations for groups are one column up to four on the TV, and two from five. On a laptop,
  one column for one or two stations, and two from three.
- Before the first result, the right side reads "Players", with the handles in a grid, and
  "Places start after the first group."
- **Standings** show place, handle, points, and groups played. "Round 1 of 2" sits on the
  right while qualifying goes on. A player in an open tie reads "Tie". The cut line reads
  "Top 4 go to the final". When a tie straddles the cut, the line goes above the whole tied
  group, so only the rows above it are surely through.
- The tie banner has one line per tie, worded like the host's (see the host section above).
- **The final** shows "Final" with the four finalists large, each with the points they came in
  with. With 2 to 4 players the points are left off.
- **The finished event** shows "Final standings". Places 1 to 3 sit in boxes, with 1st the
  largest, in the gold win color, with a trophy and the title "Winner". 2nd and 3rd are a step
  smaller. Everyone else is in a list.
- Group type sizes are measured fits (see the comments in `pages/display/model.ts`). Stations
  on the TV (1920 by 1080): one station h4, two h5, three or four h6 in one column, five to
  eight h6 in two columns. On a laptop (1366 by 768): one station h6, two subtitle1, three to
  eight body2 in two columns.
- Standings on the TV: up to 6 rows h3, 7 to 10 rows h4, 11 and up h5. On a laptop: up to 8
  rows h5, 9 to 12 rows h6, 13 and up subtitle1. Past 16 rows the standings split into two
  tables side by side, and the type comes from the rows of the first table.
- The minimum type size for the TV has no published source yet. It is set by testing on the
  real TV (see `PLAYTEST.md`) and recorded here.

### Player page (phone)

The page at `/follow`. It is one column, up to MUI's `sm` container width, and it works at 320
CSS pixels (see "Phone width"): handles and status words wrap anywhere (`overflowWrap`), and
the standings table has fixed columns, so the handle gets what is left. Top to bottom:

- **Header.** The logo and the event name.
- **Sound row.** Before sound is on, one large **Tap to turn on sound** button. After the
  first tap anywhere on the page, it reads "Sound is on." with a speaker icon. The row keeps
  its height either way, so the tap that turns sound on doesn't move what the finger is on.
  Under it: "Alerts work best with this page open."
- **Lock screen alerts.** Shown only when the server offers push (online, over HTTPS). Offline
  and over plain HTTP the page shows nothing here. The states:

  | State | What shows |
  |---|---|
  | Off | **Turn on lock screen alerts**, and "Get an alert even when this page is closed." |
  | On | "Lock screen alerts are on." and **Turn off** |
  | Blocked in the browser | "Your browser blocked alerts. Turn them on in its settings." |
  | Not possible in this browser | "This browser can't show lock screen alerts." |
  | iPhone or iPad in Safari | "On iPhone, lock screen alerts need the Home Screen. Tap Share, then Add to Home Screen, and sign in again there." |
  | A try that failed | A red alert, "Couldn't turn on lock screen alerts. Try again." |

  While the page checks the browser, nothing shows.
- **Player cards**, one for each followed player (up to 6), in the order they were followed.
  A card has the handle, a status block, a line with the others in the match, and
  **Stop following**, which asks "Stop following Zap?" first, because following again needs
  the PIN. A dialog fits here because only the PIN undoes it (see "Undo, not 'Are you sure?'" above).
- **Follow another player**, switched off at 6 with the line "This phone follows 6 players. Stop
  following one to add another."
- **Standings**, when a bracket or groups exist.
- **Sign out** and the color mode picker.

**Status block.** Each status has an icon and words, and the block's look follows
`alertLevel` from `packages/core`, so the card and the alerts agree. Color is never the only
signal.

| Status | Words | Look |
|---|---|---|
| Called | "You're up! Go to station 2" | Crimson fill, light crimson outline |
| Next | "You're next" | `upNext` fill |
| Two away | "Two matches away" (groups: "Two groups away") | `upNext` outline |
| Later | "About 4 matches away" | Plain outline |
| Waiting | "Waiting for your next match" | Plain outline |
| Out | "You're out. Thanks for playing!" (round robin: "All your matches are played. Thanks for playing!") | Plain outline |
| Done | "You won! Finished 1st", "Finished 2nd", and so on ("The event is over. Thanks for playing!" with no place) | Gold `win` fill for places 1 to 3, else plain outline |
| Not in it | "The host hasn't started yet", or "You're not playing in this one" once something has started | Plain outline |

The line under the block is "Against Kai" for a match and "With Kai, Blaze, and Jett" for a
group, and is left off when nobody else is known. The words live in
`packages/client/src/pages/phone/phoneWords.ts`.

**Next banner.** "Zap, you're next! Get ready." in `upNext`, stuck to the top while the page
scrolls, with a close button for that player. No sound. The tab title shows "Zap, you're
next!" while it is up.

**Called overlay.** A full-screen dialog with a crimson background that pulses to black and
back once a second: one flash a second, under the limit of three in WCAG 2.2 success
criterion 2.3.1 (<https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html>),
and eased, not a hard cut. Under `prefers-reduced-motion` the background stays crimson. It
reads "You're up!", then "Zap, go to station 2!" in the largest type for each player called,
"With Kai" under it when others are known, and one white **On my way** button, white on both
ends of the pulse. The tab title flips between "Zap: go to station 2" and the page name at
the same pace. The sound is three rising beeps made in the page, and phones that support it
also buzz.

**Standings table.** Columns are place, handle, and two numbers: Wins and Losses for a
bracket, Points and Groups for groups. The heading is "Standings", or "Final standings" once
finished. Rows of players this phone follows are bold with a person icon, whose label is "You
follow this player", so the mark isn't only the weight. For groups, the cut line is a row
across the table that reads "Top 4 go to the final", in crimson on light and `primary.light`
on dark, and sits above a whole tied group, as on the Display. Before any group has a
result, the heading is "Players", the handles are a list, and the page says "Places start
after the first group."

**Home Screen app.** The manifest's `theme_color` is `primary.main`, which is the same crimson
in both modes. Its `background_color` is the light `background.default`, because a manifest
has one color per field and no dark variant. The icons sit on that same background, because
iOS fills a transparent icon with black. `tools/make-icons.ts` makes them.

## Name tags

- The print layout is its own page, sized by CSS `@page` for the label preset.
- The handle is the largest thing on the tag. The PIN is small in a corner, so it isn't read
  from across the room.
- The tag is black on white, with no theme colors, so a one-color thermal printer prints it
  as designed (`PLAN.md`, "The tag"). The print page has no app bar and no controls.
- **The Name tags panel** (M8) is on `/host` in setup and play mode. In order: the label size
  select, **Print 5 new tags** (a contained button whose count is the queue, turned off at 0),
  **Print a test tag**, and the event graphic with **Choose a picture** and **Remove**. The
  test tag prints "SampleName", "PIN 0000", and a thin outline at the 3 mm safe edge, so the
  host can see whether anything is cut off.
- After the print dialog closes, a dialog asks "Did all 5 tags print?" with **Yes** and **No,
  keep them**. The question names the count, because a browser can't tell a printed page from
  a cancelled one.
- Each player row in the players list has a **Print tag** icon button with that label as its
  tooltip and accessible name. It adds the tag to the print list and says so in a snackbar:
  "Added to the print list. Reprints have no PIN."
- A refused picture says why in words: "Use a PNG, JPEG, or WebP picture.", "That picture is
  over 2 MB.", or "That picture is too small or too big. Use one from 16 to 4000 pixels on each
  side."
- The Display screen shows the graphic beside the event name, no taller than the name's line.
