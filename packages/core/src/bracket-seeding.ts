// Seeding for a bracket (docs/PLAN.md, section 5). The list is player ids in starting-spot
// order, then nulls (empty slots) at the end. The bracket library gives the first spots the
// byes, so the top seeds skip round 1 and two byes never meet.

import type { BracketFormat } from './api.ts';
import { shuffle, type RandomSource } from './random.ts';

export const BRACKET_PLAYERS_MAX = 32;
export const STATIONS_MIN = 1;
export const STATIONS_MAX = 8;

/** A player id, or null for an empty slot (a bye, or the odd one out in a round robin). */
export type Seeding = ReadonlyArray<number | null>;

/**
 * Two lives needs 3: the library makes one match for 2 players and no final, so there would
 * be nothing to play for a second life.
 */
export function bracketPlayersMin(format: BracketFormat): number {
  return format === 'double' ? 3 : 2;
}

/**
 * The slots the library needs: a power of two for elimination, an even count for a round
 * robin (the extra slot is the player who sits out each round).
 */
export function bracketSize(format: BracketFormat, playerCount: number): number {
  if (format === 'round_robin') return playerCount + (playerCount % 2);
  let size = 2;
  while (size < playerCount) size *= 2;
  return size;
}

/** Shuffles the players with the caller's random source, then pads with nulls. */
export function seedPlayers(format: BracketFormat, playerIds: readonly number[], random: RandomSource): Array<number | null> {
  const min = bracketPlayersMin(format);
  if (playerIds.length < min || playerIds.length > BRACKET_PLAYERS_MAX) {
    throw new RangeError(`${format} takes ${min} to ${BRACKET_PLAYERS_MAX} players, got ${playerIds.length}`);
  }
  if (new Set(playerIds).size !== playerIds.length) throw new RangeError('a player is listed twice');

  const seeding: Array<number | null> = shuffle(playerIds, random);
  const size = bracketSize(format, playerIds.length);
  while (seeding.length < size) seeding.push(null);
  return seeding;
}

/**
 * A late player takes the first empty slot. Null means there is none. Whether the format
 * and the stage of play allow it is the server's check (docs/PLAN.md, "Late sign-up").
 */
export function addLatePlayer(seeding: Seeding, playerId: number): Array<number | null> | null {
  if (seeding.includes(playerId)) throw new RangeError('that player is already in the seeding');
  const slot = seeding.indexOf(null);
  if (slot === -1) return null;
  const next = [...seeding];
  next[slot] = playerId;
  return next;
}
