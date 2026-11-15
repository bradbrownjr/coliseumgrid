import { GRAPHIC_BYTES_MAX, LABEL_CUSTOM_MAX_MM, LABEL_CUSTOM_MIN_MM } from '@coliseumgrid/core';

// The words of the Name tags panel (docs/DESIGN.md, "Name tags"), apart from the screen so a test can read them.

export const NAME_TAGS_TITLE = 'Name tags';

/** What the reprint snackbar says. A PIN already waiting in the list prints; otherwise the tag has none. */
export const reprintAddedWords = (pin: string | null): string => (pin === null ? 'Added to the print list. Reprints have no PIN.' : 'Added to the print list.');

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/** The main button: "Print 5 new tags". */
export function printButtonWords(count: number): string {
  return `Print ${count} new ${plural(count, 'tag', 'tags')}`;
}

/** The question after the print dialog closes. A browser can't tell a printed page from a cancelled one. */
export function printedQuestion(count: number): string {
  return count === 1 ? 'Did the tag print?' : `Did all ${count} tags print?`;
}

/** What each answer does, said once under the question. */
export function printedHelp(count: number): string {
  return count === 1
    ? 'Pick Yes and it leaves the print list. Pick No to keep it.'
    : 'Pick Yes and they leave the print list. Pick No to keep them.';
}

export const CUSTOM_SIZE_WORDS = `Use ${LABEL_CUSTOM_MIN_MM} to ${LABEL_CUSTOM_MAX_MM} mm on each side.`;

export const PICTURE_HELP = `A PNG, JPEG, or WebP picture, up to ${GRAPHIC_BYTES_MAX / (1024 * 1024)} MB.`;
export const PICTURE_NONE = 'No picture yet.';
