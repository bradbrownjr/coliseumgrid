// PINs (src/pin.ts): the suggestion from a seeded source, and the format check.

import { describe, expect, it } from 'vitest';
import { PIN_LENGTH, createSeededRandom, isValidPin, suggestPin } from '../src/index.ts';

// Each expected PIN is floor(output * 10000 / 2^32) for the first outputs of that seed, which
// test/random.test.ts checks against the author's C implementation. Seed 0 gives "0003" and
// seed 1 gives "0027" second, which covers leading zeros.
const SUGGESTED: ReadonlyArray<readonly [seed: number, pins: readonly string[]]> = [
  [0, ['2664', '0003', '2232', '1462']],
  [1, ['6270', '0027', '5274', '9810']],
  [42, ['6011', '4482', '8524', '6697']],
];

describe('suggestPin', () => {
  it.each(SUGGESTED)('seed %i gives the expected PINs', (seed, pins) => {
    const random = createSeededRandom(seed);
    expect(pins.map(() => suggestPin(random))).toEqual([...pins]);
  });

  it('keeps leading zeros and the range ends', () => {
    expect(suggestPin(() => 0)).toBe('0000');
    expect(suggestPin(() => 0.0427)).toBe('0427');
    expect(suggestPin(() => 0.9999999999)).toBe('9999');
  });

  it('always gives 4 digits that pass isValidPin', () => {
    const random = createSeededRandom(2027);
    for (let i = 0; i < 2000; i++) {
      const pin = suggestPin(random);
      expect(pin).toHaveLength(PIN_LENGTH);
      expect(isValidPin(pin), pin).toBe(true);
    }
  });

  it('gives the same PINs for the same seed', () => {
    const a = createSeededRandom(7);
    const b = createSeededRandom(7);
    for (let i = 0; i < 50; i++) expect(suggestPin(a)).toBe(suggestPin(b));
  });
});

describe('isValidPin', () => {
  it('takes exactly 4 digits, leading zeros included', () => {
    for (const pin of ['0000', '0427', '1234', '9999']) expect(isValidPin(pin), pin).toBe(true);
  });

  it('turns down everything else', () => {
    const bad = ['', '1', '123', '12345', 'abcd', '12a4', ' 123', '123 ', '1234\n', '12-4', '１２３４', '١٢٣٤', '12.4'];
    for (const pin of bad) expect(isValidPin(pin), JSON.stringify(pin)).toBe(false);
  });
});
