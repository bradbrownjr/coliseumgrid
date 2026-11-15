// Name tags (docs/PLAN.md, section 7): the label sizes the print page offers, and the limits on
// the event graphic. Pure data, shared so the host page and the server use the same numbers.

/**
 * A label size with a fixed page. Width and height are the CSS `@page` size in millimetres,
 * narrow side first, because a thermal label runs through the printer that way (PLAN.md,
 * "Label sizes").
 */
export interface LabelPreset {
  id: LabelPresetId;
  /** What the label size select shows. */
  name: string;
  /** The label it was measured from. */
  label: string;
  widthMm: number;
  heightMm: number;
}

export type LabelPresetId = '62x100mm' | '2.25x4in';

/** The id of the size the host types; it has no fixed page. */
export const LABEL_CUSTOM_ID = 'custom';

export const LABEL_PRESETS: readonly LabelPreset[] = [
  // Brother's QL-800 driver PPD lists `62x100` (PLAN.md, "The printer").
  { id: '62x100mm', name: '62 x 100 mm', label: 'Brother DK-11202', widthMm: 62, heightMm: 100 },
  // The DYMO driver's `w167h288.2` is 166.56 by 288 points; at 25.4 / 72 mm a point that is
  // 58.758 by 101.6 mm, rounded to 0.01 mm.
  { id: '2.25x4in', name: '2-1/4 x 4 in', label: 'DYMO 30857', widthMm: 58.76, heightMm: 101.6 },
];

export const LABEL_PRESET_DEFAULT: LabelPresetId = '62x100mm';

/** Text and the graphic stay this far inside every edge, clear of the printers' imageable-area insets. */
export const LABEL_SAFE_EDGE_MM = 3;

/** A custom label's width and height are each 25 to 150 mm. */
export const LABEL_CUSTOM_MIN_MM = 25;
export const LABEL_CUSTOM_MAX_MM = 150;

/** True when a typed custom size is a number from 25 to 150 mm on both sides. */
export function isCustomLabelSize(widthMm: number, heightMm: number): boolean {
  const ok = (mm: number): boolean => Number.isFinite(mm) && mm >= LABEL_CUSTOM_MIN_MM && mm <= LABEL_CUSTOM_MAX_MM;
  return ok(widthMm) && ok(heightMm);
}

/** The largest graphic upload: 2 MB, counted as 2 x 1024 x 1024 bytes. */
export const GRAPHIC_BYTES_MAX = 2 * 1024 * 1024;

/** A graphic's width and height, read from its header, are each 16 to 4000 pixels. */
export const GRAPHIC_SIZE_MIN = 16;
export const GRAPHIC_SIZE_MAX = 4000;
