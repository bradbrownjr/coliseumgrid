// The rough vulgarity filter for handles. Ported from Pattern Break's
// packages/core/src/name.ts (same author, MIT), keeping its lists, its two readings, and
// its innocent-name tests. Changes: '!' is no longer read as 'I' because a handle can't hold
// it, and the readings take any case, so `Zap`, `ZAP`, and `zap` get one verdict.
//
// A plain list of words matched anywhere blocks innocent words that contain one, the
// "Scunthorpe problem" (Wikipedia, "Scunthorpe problem": broad rules "may result in false
// positives affecting many innocent phrases"). So a root that sits inside common words
// (ASS in CLASS and CUTLASS, TIT in TITLE) counts only as a whole word, and only a root that
// rarely does (FUCK) counts anywhere. Each pattern runs on two readings of the handle: with
// look-alike digits read as letters (A55 as ASS) and marks as spaces, and the same with runs
// of single letters joined, so A.S.S and F U C K fail too. Whole words are never joined, or
// PUSH IT would read as PUSHIT. The innocent handles in test/vulgarity.test.ts are the check
// against false matches.
//
// The lists are English only and catch obvious cases; they are not a promise that no rude
// handle gets through. The host can rename a player (docs/PLAN.md, section 4).

/** Roots that count anywhere in a handle. */
const ANYWHERE = new RegExp(
  [
    'F+U+C+K',
    'SH+I+T',
    '(?<!S)C+U+N+T',
    'N+I+G+G',
    'NIGLET',
    'F+A+G+O+T',
    'F+A+G+G',
    'WH+O+R+E',
    'P+U+S+S+Y',
    'B+I+T+C+H',
    'SLUT',
    'DILDO',
    'PENIS',
    'VAGINA',
    'RAPIST',
    'JIZZ',
    'PORN',
    'TWAT',
    'PISS',
    'HITLER',
    'KKK',
    'BOLLOCK',
    'WANKER',
    'ASS(?:HOLE|HAT|WIPE|CLOWN|FACE|LICK)',
    '(?:DUMB|JACK|FAT|LAME|BAD|KICK)ASS',
    'DICK(?:HEAD|FACE|S\\b)',
    'COCK(?:SUCK|HEAD|S\\b)',
    'CUMSHOT',
    'MOTHERF',
  ].join('|'),
);

/** Roots that count only as a whole word: they sit inside too many innocent ones. */
const WORD = new RegExp(
  `(?:^| )(?:${[
    'ASS(?:ES)?',
    'ARSE',
    'TITS?',
    'TITTY',
    'TITTIES',
    'FAGS?',
    'DICK',
    'COCK',
    'CUM',
    'SEXY?',
    'ANAL',
    'ANUS',
    'RAPED?',
    'RAPES',
    'HOMO',
    'BOOBS?',
    'WANK',
    'NAZIS?',
    'SPERM',
  ].join('|')})(?= |$)`,
);

const LOOKALIKES: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '3': 'E',
  '4': 'A',
  '5': 'S',
  '7': 'T',
  '8': 'B',
  '9': 'G',
};

/**
 * The two readings the filter checks: look-alikes as letters and marks as spaces
 * ("A55-MAN" as "ASS MAN"), and that with runs of single letters joined ("A S S" as "ASS").
 * Both are in capitals, so the case a handle was typed in doesn't matter.
 */
export function handleReadings(handle: string): { spaced: string; joined: string } {
  let spaced = '';
  for (const c of handle.toUpperCase()) spaced += LOOKALIKES[c] ?? (c >= 'A' && c <= 'Z' ? c : ' ');
  const words: string[] = [];
  let letters = '';
  for (const word of spaced.split(' ')) {
    if (word.length === 1) {
      letters += word;
      continue;
    }
    if (letters) words.push(letters);
    letters = '';
    if (word) words.push(word);
  }
  if (letters) words.push(letters);
  return { spaced, joined: words.join(' ') };
}

/** True when the filter finds an obvious vulgarity in `handle`. */
export function isVulgar(handle: string): boolean {
  const { spaced, joined } = handleReadings(handle);
  return ANYWHERE.test(spaced) || ANYWHERE.test(joined) || WORD.test(spaced) || WORD.test(joined);
}
