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

## Core principles

### Symmetry and uniformity

The same control looks and acts the same everywhere: same icon, same label, same color, same
place. A "Next match" button on the host screen and on the queue panel are one component.

### Fixed answers use a picker, never free text

A field with a fixed set of answers (format, best-of, heat size, label size) is a select,
radio group, or toggle buttons. Free text is only for event names and handles.

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
confirmation dialog is only for actions that can't be undone, like deleting an event.

## The three screens

### Host (laptop)

- The setup wizard has three steps: name and game, a format card, start. Defaults are
  filled in; the rest is under "More options".
- During play, the queue is the main view: each station's current match, "Up next", and
  one-tap result buttons.

### Sign-up (tablet)

- One task per screen: handle, then PIN, then done.
- The on-screen keypad for the PIN is large. The suggested PIN is already in the field with
  **Keep** as the main button.
- A refused handle says what to do next ("Pick another handle"), never why in detail.

### Display (TV)

- Read from across a room, with no input. Large type, high contrast, nothing that needs a
  hover or a click.
- Dark theme by default.
- The minimum type size for the TV has no published source yet. It is set in M3 by testing
  on the real TV (see `PLAYTEST.md`) and recorded here.

## Name tags

- The print layout is its own page, sized by CSS `@page` for the label preset.
- The handle is the largest thing on the tag. The PIN is small in a corner, so it isn't read
  from across the room.
