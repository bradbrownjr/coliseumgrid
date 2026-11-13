// Races and free-for-all (docs/PLAN.md, section 5, "Races and free-for-all"). A heat is a group
// of 2 to 4 players who play together; each finishing place earns points from the event's
// points table. Players play `rounds` qualifying heats each, regrouped by points between
// rounds, and the top 4 by points play the final, whose finishing order alone sets places 1
// to 4. With 2 to 4 players there are no qualifying rounds: the one heat is the final.
//
// Everything here is pure. The server stores the seeding and the result log, and replays
// them through these functions; nothing here reads a clock or makes its own randomness.

import { shuffle, type RandomSource } from './random.ts';
import type { RankedGroup } from './ties.ts';

/** The most players in one heat: one console's controllers in the games planned. */
export const HEAT_SIZE_MAX = 4;
/** The top this many by points play the final. */
export const FINAL_SIZE = 4;
export const HEAT_PLAYERS_MIN = 2;
export const HEAT_PLAYERS_MAX = 32;
export const HEAT_ROUNDS_MIN = 1;
export const HEAT_ROUNDS_MAX = 3;
export const HEAT_ROUNDS_DEFAULT = 2;
/** Races per heat is a label for the host, like best of in a bracket. */
export const HEAT_RACES_MIN = 1;
export const HEAT_RACES_MAX = 4;
export const HEAT_POINTS_MAX = 20;
/** Points for 1st to 4th (Brad, 2026-11-13). Heats of 3 and 2 use the first 3 and 2. */
export const DEFAULT_POINTS: readonly number[] = [4, 3, 2, 1];

/**
 * Heat sizes for `playerCount` players: ceil(n / 4) heats, as even as possible, larger heats
 * first. Never a heat of 1; a heat of 2 only at 2 and 5 players.
 */
export function splitHeats(playerCount: number): number[] {
  if (!Number.isInteger(playerCount) || playerCount < HEAT_PLAYERS_MIN) {
    throw new RangeError(`heats need at least ${HEAT_PLAYERS_MIN} players, got ${playerCount}`);
  }
  const count = Math.ceil(playerCount / HEAT_SIZE_MAX);
  const base = Math.floor(playerCount / count);
  const larger = playerCount % count;
  return Array.from({ length: count }, (_, i) => base + (i < larger ? 1 : 0));
}

/** Cuts an ordered list into heats of `splitHeats` sizes, in order, so the larger heats take the top of the list. */
export function cutIntoHeats(order: readonly number[]): number[][] {
  if (new Set(order).size !== order.length) throw new RangeError('a player is listed twice');
  const heats: number[][] = [];
  let start = 0;
  for (const size of splitHeats(order.length)) {
    heats.push(order.slice(start, start + size));
    start += size;
  }
  return heats;
}

/** More than `FINAL_SIZE` players play qualifying rounds; 2 to 4 play only the final. */
export function hasQualifying(playerCount: number): boolean {
  return playerCount > FINAL_SIZE;
}

/**
 * The seeding: the players shuffled with the caller's random source. Round 1 is
 * `cutIntoHeats(seeding)`, and players level on points stay in seeding order after it.
 */
export function seedHeats(playerIds: readonly number[], random: RandomSource): number[] {
  if (playerIds.length < HEAT_PLAYERS_MIN || playerIds.length > HEAT_PLAYERS_MAX) {
    throw new RangeError(`heats take ${HEAT_PLAYERS_MIN} to ${HEAT_PLAYERS_MAX} players, got ${playerIds.length}`);
  }
  if (new Set(playerIds).size !== playerIds.length) throw new RangeError('a player is listed twice');
  return shuffle(playerIds, random);
}

/**
 * A valid points table: 4 whole numbers from 0 to 20 for 1st to 4th, never rising, and 1st
 * worth at least 1, so winning a heat always counts.
 */
export function isPointsTable(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== HEAT_SIZE_MAX) return false;
  const points = value as unknown[];
  return points.every(
    (p, i) =>
      Number.isInteger(p) &&
      (p as number) >= (i === 0 ? 1 : 0) &&
      (p as number) <= HEAT_POINTS_MAX &&
      (i === 0 || (p as number) <= (points[i - 1] as number)),
  );
}

/** True when `order` names every player of the heat once and nobody else. */
export function isFinishOrder(players: readonly number[], order: readonly number[]): boolean {
  return order.length === players.length && new Set(order).size === order.length && order.every((id) => players.includes(id));
}

export interface HeatScore {
  player: number;
  points: number;
  /** Qualifying heats with a result. Tie-break heats and the final don't count. */
  heatsPlayed: number;
}

/**
 * Points so far, most first; players level on points stay in seeding order. `finishes` are
 * the finishing orders of the qualifying heats that have a result.
 */
export function scoreHeats(
  seeding: readonly number[],
  finishes: ReadonlyArray<readonly number[]>,
  points: readonly number[],
): HeatScore[] {
  const scores = new Map(seeding.map((player) => [player, { player, points: 0, heatsPlayed: 0 }]));
  for (const order of finishes) {
    order.forEach((player, place) => {
      const score = scores.get(player);
      if (!score) throw new RangeError(`player ${player} is not in the seeding`);
      score.points += points[place] ?? 0;
      score.heatsPlayed += 1;
    });
  }
  // Array sort is stable (ES2019), so level players keep seeding order.
  return [...scores.values()].sort((a, b) => b.points - a.points);
}

/** The next round's heats: `cutIntoHeats` over the players by points so far. No new randomness. */
export function regroup(scores: readonly HeatScore[]): number[][] {
  return cutIntoHeats(scores.map((s) => s.player));
}

/** Groups players level on points; a group shares its places. */
export function rankByPoints(scores: readonly HeatScore[]): RankedGroup[] {
  const groups: RankedGroup[] = [];
  let place = 1;
  scores.forEach((score, i) => {
    const last = groups.at(-1);
    if (last && scores[i - 1]?.points === score.points) last.players.push(score.player);
    else groups.push({ place, players: [score.player] });
    place += 1;
  });
  return groups;
}

/**
 * A tie-break heat, as made by "Play tie-break". `pass` counts from 1: a pass that leaves
 * players level at the cut is followed by another among only them.
 */
export interface TieBreakHeat {
  pass: number;
  players: readonly number[];
  /** Finishing order, or null before a result. */
  order: readonly number[] | null;
}

/** Players level across the cut, and the tie-break heats that settle them. */
export interface CutTie {
  /** The first place the group shares. */
  place: number;
  players: number[];
  pass: number;
  /** The heats of this pass: the ones made, or, before that, the ones to make. */
  heats: number[][];
  /** True once the pass's heats are made. */
  started: boolean;
}

export interface FinalCut {
  /** Qualifying order, refined by the tie-break heats played. Groups share places. */
  ranking: RankedGroup[];
  /** The players in the final, in ranking order; null while a tie at the cut is unsettled. */
  finalists: number[] | null;
  tie: CutTie | null;
}

const groupAt = (ranking: readonly RankedGroup[], finalSize: number): RankedGroup | undefined =>
  ranking.find((g) => g.place <= finalSize && g.place + g.players.length - 1 > finalSize);

/**
 * Who reaches the final. Call it once every qualifying heat has a result: before that the
 * order is provisional. A group level on points that straddles place `finalSize` plays a
 * tie-break pass: `cutIntoHeats` over the group, then the group is ordered by finishing place
 * in its heat (1st places level with each other, then 2nd places, and so on). A part still
 * level across the cut plays another pass. Each pass leaves at most one player per heat in a
 * level, so it ends. The order the tie-breaks set stands below the cut too.
 */
export function settleCut(ranking: readonly RankedGroup[], tieBreaks: readonly TieBreakHeat[], finalSize = FINAL_SIZE): FinalCut {
  let current = ranking.map((g) => ({ place: g.place, players: [...g.players] }));
  let pass = 1;
  for (;;) {
    const group = groupAt(current, finalSize);
    if (!group) break;
    const made = tieBreaks.filter((t) => t.pass === pass);
    const tie = (heats: number[][], started: boolean): FinalCut => ({
      ranking: current,
      finalists: null,
      tie: { place: group.place, players: [...group.players], pass, heats, started },
    });
    if (made.length === 0) return tie(cutIntoHeats(group.players), false);
    const covered = made.flatMap((t) => [...t.players]);
    if (covered.length !== group.players.length || !group.players.every((id) => covered.includes(id))) {
      throw new RangeError(`tie-break pass ${pass} does not hold the players tied at the cut`);
    }
    if (made.some((t) => t.order === null)) return tie(made.map((t) => [...t.players]), true);

    const placeIn = new Map(made.flatMap((t) => (t.order ?? []).map((id, i) => [id, i] as const)));
    const levels: RankedGroup[] = [];
    let place = group.place;
    for (let finish = 0; finish < HEAT_SIZE_MAX; finish++) {
      const level = group.players.filter((id) => placeIn.get(id) === finish);
      if (level.length === 0) continue;
      levels.push({ place, players: level });
      place += level.length;
    }
    current = current.flatMap((g) => (g === group ? levels : [g]));
    pass += 1;
  }
  if (tieBreaks.some((t) => t.pass >= pass)) throw new RangeError(`no tie needs tie-break pass ${pass}`);
  const finalists = current.flatMap((g) => g.players).slice(0, finalSize);
  return { ranking: current, finalists, tie: null };
}

/**
 * Final places. The final's finishing order gives places 1 to its size; everyone else keeps
 * their place in `ranking` (settleCut's), shared when level. Before the final has a result
 * the ranking stands as it is.
 */
export function finalPlaces(ranking: readonly RankedGroup[], finalOrder: readonly number[] | null): RankedGroup[] {
  if (finalOrder === null) return ranking.map((g) => ({ place: g.place, players: [...g.players] }));
  const inFinal = new Set(finalOrder);
  const rest = ranking.map((g) => ({ place: g.place, players: g.players.filter((id) => !inFinal.has(id)) })).filter((g) => g.players.length > 0);
  if (rest.some((g) => g.place <= finalOrder.length)) throw new RangeError('a player outside the final ranks above it');
  return [...finalOrder.map((id, i) => ({ place: i + 1, players: [id] })), ...rest];
}

/** A round 1 heat a late player might join. */
export interface LateHeat {
  id: number;
  number: number;
  size: number;
  /** Not called to a station and no result. */
  waiting: boolean;
}

/**
 * The heat a late player joins: the smallest round 1 heat still waiting with room, the lowest
 * number on a tie. Null when there is none; the server then refuses with `late-closed`.
 */
export function lateJoinHeat(heats: readonly LateHeat[]): number | null {
  const open = heats.filter((h) => h.waiting && h.size < HEAT_SIZE_MAX);
  open.sort((a, b) => a.size - b.size || a.number - b.number);
  return open[0]?.id ?? null;
}
