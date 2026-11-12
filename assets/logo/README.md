# Logo

The ColiseumGrid mark: a two-tier coliseum with a tournament bracket rising from its edges
to one winner at the top, under a pennant. The app doesn't use these files yet.

| File | What it is | Use it for |
|---|---|---|
| `logo.svg` | Full mark, five arches per tier, three bracket levels | Light backgrounds at 48 px and up: headers, the README, printed name tags |
| `logo-dark.svg` | Same mark in the dark colors | Dark backgrounds at 48 px and up: the TV screen, dark mode |
| `icon.svg` | Simplified mark for 16 to 32 px | Favicon and browser tab on a light background |
| `icon-dark.svg` | Same icon in the dark colors | Favicon and tab on a dark background |
| `concept-a.webp` | The original concept image | Reference only; don't ship it |

The icon drops to three arches per tier and two bracket levels, uses strokes two and a half
times as thick, and leaves off the ball on top of the pole.

## Colors

All four SVGs have a transparent background and no text. Each dark file has the same paths
as its light file; only the colors and the mask `id` change. The `id`s differ so two marks
placed inline on one page don't share a mask.

| Part | Light | Dark |
|---|---|---|
| Coliseum | `#1C1717` (`secondary.main`) | `#EDE6E6` (dark `secondary.main`) |
| Bracket and flag | `#B80F2A` (`primary.main`) | `#FF6060` (dark `primary.light`) |

The dark version uses `#FF6060` because crimson strokes on the dark backgrounds are under
3:1: 2.95:1 on `#0D0A0A` and 2.69:1 on `#1C1515`. `#FF6060` is 6.66:1 and 6.08:1. This
follows the dark-mode rule in [`docs/DESIGN.md`](../../docs/DESIGN.md), "Colors". The other
pairs, checked 2026-11-12 with the WCAG 2.2 contrast formula:

| Color | On `#FFFFFF` | On `#F4F0EF` | On `#0D0A0A` | On `#1C1515` |
|---|---|---|---|---|
| `#1C1717` | 17.73:1 | 15.67:1 | | |
| `#B80F2A` | 6.69:1 | 5.91:1 | | |
| `#EDE6E6` | | | 16.02:1 | 14.61:1 |
| `#FF6060` | | | 6.66:1 | 6.08:1 |

## Where it came from

The concept was made with an AI image generator (nexarc, OpenAI gpt-image-2.5-sunburst,
2026-11-12) and is kept as `concept-a.webp`. The SVGs were redrawn by hand from it and
checked side by side with it in a browser. They keep its raised center block, its larger
center arch, and its bracket legs running behind the building. They differ in being exactly
symmetric, with one stroke width per file and bracket lines thicker than the concept's so they
read at 32 px.
