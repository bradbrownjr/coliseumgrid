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
  `MuiChip` (outlined), and `MuiOutlinedInput` and `MuiInputLabel` (focused). A selected
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
radio group, or toggle buttons. Free text is only for event names and handles.

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

## The three screens

### Host (laptop)

- The setup wizard has three steps: name and game, a format card, start. Defaults are
  filled in; the rest is under "More options".
- During play, the queue is the main view: each station's current match, "Up next", and
  one-tap result buttons.
- A station card has one large button per player, reading "<handle> won". A tap records that
  player as the winner of the whole match, whatever the best-of label says.
- A tap shows "<handle> won" in the snackbar with **Undo**. Every recorded result also has its
  own **Undo** in the Results list, newest first.
- The **Competition** section runs one bracket or one set of groups. **Start a competition**
  opens the start dialog. Once a competition has finished, the button reads **New competition**.
- **Delete bracket** or **Delete groups** asks first, since it can't be undone. Results don't ask.
- While a tie is open, **Play tie-break** starts its matches. While late sign-up is open,
  **Add to bracket** (or **Add to group**, when the event runs groups) is in a player's menu.
- The start dialog's first choice is **Bracket** or **Races and free-for-all**. Groups add
  **Games in each group** (1 to 4; a game is a race or a match), **Rounds before the final** (1 to 3, or none with 2 to 4
  players), and the points for 1st to 4th. **Use 4, 3, 2, 1** appears once the points change.
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

### Sign-up (tablet)

- One task per screen: handle, then PIN, then done.
- Entry panels (the handle field, the PIN keypad) are centered on the screen (Brad,
  2026-11-12).
- The on-screen keypad for the PIN is large. The suggested PIN is already in the field with
  **Keep** as the main button.
- A refused handle says what to do next ("Pick another handle"), never why in detail.

### Display (TV)

- Read from across a room, with no input. Large type, high contrast, nothing that needs a
  hover or a click.
- Always dark, whatever color mode the host picks.
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

## Name tags

- The print layout is its own page, sized by CSS `@page` for the label preset.
- The handle is the largest thing on the tag. The PIN is small in a corner, so it isn't read
  from across the room.
