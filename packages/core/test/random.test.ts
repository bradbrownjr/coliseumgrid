import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../src/index.ts';

// Expected values come from the author's C implementation (Tommy Ettinger's mulberry32.c,
// see src/random.ts), compiled and run for each seed. Each float is the 32-bit output
// divided by 2^32, so multiplying it back gives the integer exactly.
const REFERENCE: ReadonlyArray<readonly [seed: number, outputs: readonly number[]]> = [
  [0, [1144304738, 1416247, 958946056, 627933444]],
  [1, [2693262067, 11749833, 2265367787, 4213581821]],
  [42, [2581720956, 1925393290, 3661312704, 2876485805]],
  [4294967295, [3850105811, 813802916, 3073704848, 4054706436]],
];

describe('createSeededRandom', () => {
  it.each(REFERENCE)('seed %i gives the reference sequence', (seed, outputs) => {
    const random = createSeededRandom(seed);
    expect(outputs.map(() => random() * 0x100000000)).toEqual([...outputs]);
  });

  it('gives the same sequence for the same seed', () => {
    const a = createSeededRandom(2027);
    const b = createSeededRandom(2027);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('gives different sequences for different seeds', () => {
    expect(createSeededRandom(1)()).not.toBe(createSeededRandom(2)());
  });

  it('keeps every value from 0 (included) to 1 (excluded)', () => {
    const random = createSeededRandom(7);
    for (let i = 0; i < 10_000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('treats a negative seed as its unsigned 32-bit form', () => {
    expect(createSeededRandom(-1)()).toBe(createSeededRandom(4294967295)());
  });

  it('keeps sources independent of each other', () => {
    const a = createSeededRandom(5);
    const b = createSeededRandom(5);
    for (let i = 0; i < 3; i++) b();
    expect(a()).toBe(createSeededRandom(5)());
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses the seed %s', (seed) => {
    expect(() => createSeededRandom(seed)).toThrow(RangeError);
  });
});
