// The numbers behind the printed name tag (docs/PLAN.md, "The tag"; docs/DESIGN.md, "Name tags").
//
// This is the one place in the client that uses millimetres, points, and named colors instead of
// theme tokens. Paper has a physical size and a one-color printer has no theme, so the tag is
// laid out in the units the printer works in. Every other screen follows the theme. The label
// sizes and the safe edge come from core, so the page and the layout can't disagree.

import { LABEL_SAFE_EDGE_MM, type EventGraphic } from '@coliseumgrid/core';

/** Black on white only, so a one-color thermal printer prints the tag as designed. */
export const PRINT_INK = 'black';
export const PRINT_PAPER = 'white';

/** The handle is sized to fit, from the biggest it can be down to the smallest that still reads across a room. */
export const HANDLE_PT_MAX = 72;
/**
 * A handle that doesn't fit at 28 points keeps shrinking down to here instead of running
 * past the safe edge: a handle cut off at the edge is worse than a small one. 16 ordinary
 * characters fit at 28 points; only a handle of the widest letters needs this.
 */
export const HANDLE_PT_FLOOR = 12;
/** Print widens or narrows text by a hair against the screen, so the fit leaves this much room. */
export const FIT_SLACK = 0.97;

/** The graphic takes at most a third of the width, and the lower band at most this share of the height. */
export const GRAPHIC_WIDTH_SHARE = 1 / 3;
export const BAND_SHARE = 0.4;

/** The event name, the game, and the PIN: 12 points on a 62 mm label, smaller on a smaller one, never under 7. */
export const SMALL_PT_MAX = 12;
export const SMALL_PT_MIN = 7;
const SMALL_PT_REFERENCE_MM = 62;

/** The gap between the graphic and the words, and the outline of the test tag. */
export const GAP_MM = 2;
export const OUTLINE_MM = 0.25;

/** A length as CSS, rounded to 0.01 mm so the styles don't carry floating-point tails. */
export const mm = (value: number): string => `${Math.round(value * 100) / 100}mm`;

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
export const mmToPt = (mm: number): number => (mm * PT_PER_INCH) / MM_PER_INCH;

/** A label's page size in millimetres, as `@page` has it: narrow side first for a thermal label. */
export interface PageMm {
  widthMm: number;
  heightMm: number;
}

/** What the tag's pieces measure on one page. All lengths are millimetres. */
export interface TagGeometry {
  /** True when the page is taller than wide: the tag is drawn wide and turned a quarter turn. */
  turn: boolean;
  /** The tag as it reads, before any turn. */
  wideMm: number;
  tallMm: number;
  /** The area inside the safe edge. */
  innerWideMm: number;
  innerTallMm: number;
  /** The row under the handle: the graphic, the words, and the PIN. */
  bandMm: number;
  /** The row above it: the handle. */
  handleMm: number;
}

export function tagGeometry(page: PageMm): TagGeometry {
  const turn = page.heightMm > page.widthMm;
  const wideMm = turn ? page.heightMm : page.widthMm;
  const tallMm = turn ? page.widthMm : page.heightMm;
  const innerWideMm = Math.max(wideMm - 2 * LABEL_SAFE_EDGE_MM, 0);
  const innerTallMm = Math.max(tallMm - 2 * LABEL_SAFE_EDGE_MM, 0);
  const bandMm = innerTallMm * BAND_SHARE;
  return { turn, wideMm, tallMm, innerWideMm, innerTallMm, bandMm, handleMm: innerTallMm - bandMm };
}

/** The graphic's size on the tag: up to a third of the width and the band's height, in its own proportions. */
export function graphicBoxMm(graphic: Pick<EventGraphic, 'width' | 'height'>, geometry: TagGeometry): { widthMm: number; heightMm: number } {
  const maxWidth = geometry.innerWideMm * GRAPHIC_WIDTH_SHARE;
  const scale = Math.min(maxWidth / graphic.width, geometry.bandMm / graphic.height);
  return { widthMm: graphic.width * scale, heightMm: graphic.height * scale };
}

/** The size of the event name, the game, and the PIN for this label. */
export function smallTextPt(geometry: TagGeometry): number {
  const scaled = (SMALL_PT_MAX * geometry.tallMm) / SMALL_PT_REFERENCE_MM;
  return Math.min(SMALL_PT_MAX, Math.max(SMALL_PT_MIN, scaled));
}

/** The biggest the handle may be: 72 points, or less when the label is too short to hold it. */
export function handleMaxPt(geometry: TagGeometry): number {
  return Math.min(HANDLE_PT_MAX, Math.max(HANDLE_PT_FLOOR, mmToPt(geometry.handleMm) * 0.9));
}

/**
 * The largest font size, in half points from `max` down to `HANDLE_PT_FLOOR`, whose text is at
 * most `available` wide. `widthAt` measures the text at a size in the browser. Text width grows
 * with the size, so one measurement gives a first guess, and the loop corrects it.
 */
export function fitPoints(widthAt: (pt: number) => number, available: number, max: number = HANDLE_PT_MAX): number {
  const room = available * FIT_SLACK;
  if (widthAt(max) <= room) return max;
  const first = widthAt(max);
  let pt = Math.floor(((max * room) / first) * 2) / 2;
  pt = Math.min(max, Math.max(HANDLE_PT_FLOOR, pt));
  // Step up while there's room (the guess can be low), then down until it fits.
  while (pt + 0.5 <= max && widthAt(pt + 0.5) <= room) pt += 0.5;
  while (pt > HANDLE_PT_FLOOR && widthAt(pt) > room) pt -= 0.5;
  return pt;
}

/** The CSS for the print page: its size, and everything but the tags hidden. */
export function printCss(page: PageMm): string {
  return [
    `@page { size: ${mm(page.widthMm)} ${mm(page.heightMm)}; margin: 0; }`,
    '@media print {',
    // The app, its dialogs, and its snackbar all sit in <body> beside the sheet.
    `  html, body { background: ${PRINT_PAPER} !important; color: ${PRINT_INK} !important; margin: 0 !important; padding: 0 !important; color-scheme: light; }`,
    '  body > *:not(#print-sheet) { display: none !important; }',
    '  #print-sheet { position: static !important; visibility: visible !important; }',
    '}',
  ].join('\n');
}
