// Randomness for the page. `packages/core` takes a seeded RandomSource from the caller
// (CLAUDE.md, rule 4); the page seeds one from the browser's crypto, so each dice tap is fresh.

import { createSeededRandom, type RandomSource } from '@coliseumgrid/core';

/** A new source with a seed from `crypto.getRandomValues`. */
export function freshRandom(): RandomSource {
  return createSeededRandom(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0);
}
