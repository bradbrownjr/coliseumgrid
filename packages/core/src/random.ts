// A seeded random source. Formats take a RandomSource from the caller instead of calling
// Math.random, so a test can fix the seed and check exact results (CLAUDE.md, rule 4).
//
// The algorithm is Mulberry32, written in 2017 by Tommy Ettinger and released under CC0:
// https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
// Its author notes that it isn't equidistributed (it can't produce about a third of all
// 32-bit values) and fails PractRand after 32 GB of output. That is far beyond what seeding
// a bracket or shuffling heats needs, but don't use it for anything that must resist guessing.

/** Returns a number from 0 (included) to 1 (excluded) on each call. */
export type RandomSource = () => number;

/** The same seed always gives the same sequence, on every engine (integer math only). */
export function createSeededRandom(seed: number): RandomSource {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`seed must be a whole number, got ${seed}`);
  }
  // `>>> 0` keeps the state an unsigned 32-bit value, so a negative seed works too.
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

/** A shuffled copy (Fisher-Yates), so every order is equally likely. */
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const held = order[i] as T;
    order[i] = order[j] as T;
    order[j] = held;
  }
  return order;
}
