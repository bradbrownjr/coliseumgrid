// Join codes (src/join-code.ts): generation, display format, and reading typed input.

import { describe, expect, it } from 'vitest';
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  createSeededRandom,
  formatJoinCode,
  generateJoinCode,
  parseJoinCode,
} from '../src/index.ts';

describe('JOIN_CODE_ALPHABET', () => {
  it('has no repeats and none of the look-alikes', () => {
    expect(new Set(JOIN_CODE_ALPHABET).size).toBe(JOIN_CODE_ALPHABET.length);
    for (const bad of '01OILUSZB') expect(JOIN_CODE_ALPHABET).not.toContain(bad);
  });
});

describe('generateJoinCode', () => {
  it('gives 6 characters from the alphabet only', () => {
    const random = createSeededRandom(2027);
    for (let i = 0; i < 2000; i++) {
      const code = generateJoinCode(random);
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      expect(code).toMatch(/^[2-9A-Z]{6}$/);
      for (const char of code) expect(JOIN_CODE_ALPHABET).toContain(char);
    }
  });

  it('gives the same codes for the same seed, and different codes for another', () => {
    const a = createSeededRandom(7);
    const b = createSeededRandom(7);
    const first = Array.from({ length: 20 }, () => generateJoinCode(a));
    expect(Array.from({ length: 20 }, () => generateJoinCode(b))).toEqual(first);
    const other = createSeededRandom(8);
    expect(Array.from({ length: 20 }, () => generateJoinCode(other))).not.toEqual(first);
  });

  it('maps bytes to characters in order and skips the rejected range', () => {
    // 0 / 256 is byte 0, the first character. Byte 243 and up is thrown away, so the
    // source is asked again.
    expect(generateJoinCode(() => 0)).toBe('222222');
    const draws = [250 / 256, 26 / 256, 255 / 256, 27 / 256, 242 / 256, 0, 1 / 256, 2 / 256];
    const random = () => draws.shift() ?? 0;
    // Kept bytes: 26 -> 'Y', 27 -> '2' (27 % 27 = 0), 242 -> 242 % 27 = 26 -> 'Y',
    // then 0 -> '2', 1 -> '3', 2 -> '4'.
    expect(generateJoinCode(random)).toBe('Y2Y234');
  });

  it('uses every character about equally often', () => {
    const random = createSeededRandom(12345);
    const counts = new Map<string, number>();
    const draws = 10_000;
    for (let i = 0; i < draws; i++) {
      for (const char of generateJoinCode(random)) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    const total = draws * JOIN_CODE_LENGTH;
    const expected = total / JOIN_CODE_ALPHABET.length;
    expect(counts.size).toBe(JOIN_CODE_ALPHABET.length);
    // Each count is binomial with a standard deviation near sqrt(expected), about 46 here.
    // 6 standard deviations leaves a fixed seed no real chance of failing by luck.
    const tolerance = 6 * Math.sqrt(expected);
    for (const char of JOIN_CODE_ALPHABET) {
      expect(Math.abs((counts.get(char) ?? 0) - expected), char).toBeLessThan(tolerance);
    }
  });
});

describe('formatJoinCode', () => {
  it('shows two groups of three', () => {
    expect(formatJoinCode('K7M4QX')).toBe('K7M-4QX');
  });
});

describe('parseJoinCode', () => {
  it.each([
    ['K7M4QX', 'no separator'],
    ['K7M-4QX', 'the displayed form'],
    ['k7m-4qx', 'lower case'],
    ['k7m4qx', 'lower case, no separator'],
    ['K7M 4QX', 'a space'],
    [' K7M - 4QX ', 'spaces around a hyphen'],
    ['K 7 M 4 Q X', 'spaces between every character'],
    ['K7-M4-QX', 'hyphens in other places'],
  ])('reads %j (%s)', (input) => {
    expect(parseJoinCode(input)).toBe('K7M4QX');
  });

  it.each([
    ['s', '5'],
    ['Z', '2'],
    ['b', '8'],
    ['u', 'V'],
  ])('reads typed %s as %s', (typed, read) => {
    expect(parseJoinCode(`${typed}AAAAA`)).toBe(`${read}AAAAA`);
  });

  it('gives back a code that formats and parses to itself', () => {
    const random = createSeededRandom(99);
    for (let i = 0; i < 500; i++) {
      const code = generateJoinCode(random);
      expect(parseJoinCode(formatJoinCode(code))).toBe(code);
    }
  });

  it.each(['', '   ', '-', 'K7M4Q', 'K7M4QXX', 'K7M-4QX-A'])('refuses wrong length %j', (input) => {
    expect(parseJoinCode(input)).toBeNull();
  });

  it.each(['0', 'O', 'o', '1', 'I', 'i', 'L', 'l', '!', '_', 'é', '٣'])(
    'refuses a code with %j in it',
    (char) => {
      expect(parseJoinCode(`K7M4Q${char}`)).toBeNull();
    },
  );
});
