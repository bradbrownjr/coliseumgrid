// A RandomSource backed by the operating system's random numbers, for the PINs the server
// suggests. packages/core takes a RandomSource from its caller (CLAUDE.md, rule 4); the
// server's is crypto.randomInt rather than Math.random, because a PIN that can be predicted
// from earlier ones is worth less than one that can't.

import { randomInt } from 'node:crypto';
import type { RandomSource } from '@coliseumgrid/core';

// randomInt's range must be less than 2**48 and its bounds safe integers
// (https://nodejs.org/docs/latest-v26.x/api/crypto.html#cryptorandomintmin-max-callback).
// 2**40 steps divided by 2**40 is exact in a double, always below 1, and makes the rounding
// bias in suggestPin's floor(random * 10000) about one in 10**8.
const STEPS = 2 ** 40;

export const secureRandom: RandomSource = () => randomInt(STEPS) / STEPS;
