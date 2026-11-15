// The time estimate (docs/PLAN.md, section 5, "Time estimate"): how many matches and waves an
// event takes, how long that is, whether it fits the host's time, and which changes would
// help. It is a planning figure, not a promise. Pure and numeric: the wording ("about 4 hours
// 45 minutes") and the finish time come from the client.
//
// A wave is a set of matches played at the same time. A plain "matches x minutes / stations"
// undercounts with several stations, because a round can't start before the round it needs is
// done, and a round with more matches than stations takes several waves. So the estimate works
// round by round from the engine's real round sizes (simulateWaves). Round robin counts at most
// one tie-break round of 3 matches; a bigger or repeated tie runs longer than the high end.

import { BRACKET_PLAYERS_MAX, STATIONS_MAX, bracketPlayersMin } from './bracket-seeding.ts';
import { HEAT_PLAYERS_MAX, HEAT_PLAYERS_MIN, HEAT_SIZE_MAX, hasQualifying } from './heats.ts';
import type { BestOf } from './api.ts';
import type { EventPlan, PlanFormat } from './event-plan.ts';

/** A low end and a high end, for every figure that depends on luck. */
export interface Range {
  low: number;
  high: number;
}

export interface Estimate {
  /** Matches, or groups with heats. Low and high differ by the rematch for the title or a tie-break. */
  matches: Range;
  /** Sets of matches played at the same time. */
  waves: Range;
  /** One match or group: minutes per game x games + changeover. Not rounded. */
  minutesPerWave: number;
  /** Waves x minutes per wave, not rounded. */
  minutes: Range;
}

/**
 * Games played in a match of this length between evenly matched players: 1 for best of 1,
 * 2 or 3 (chances 1/2 each) for best of 3, and 3, 4, or 5 (chances 1/4, 3/8, 3/8) for best of 5.
 */
export const EXPECTED_GAMES: Readonly<Record<BestOf, number>> = { 1: 1, 3: 2.5, 5: 4.125 };

/** A tie-break round among 3 players is 3 matches; a bigger tie would add more, which isn't counted. */
const TIE_BREAK_MATCHES = 3;

const log2Ceil = (n: number): number => Math.ceil(Math.log2(n));

/** The fewest players the format takes. */
function playersMin(format: PlanFormat): number {
  return format === 'heats' ? HEAT_PLAYERS_MIN : bracketPlayersMin(format);
}

/** True when the format can start with this many players (Two lives needs 3). */
export function canEstimate(format: PlanFormat, players: number): boolean {
  const max = format === 'heats' ? HEAT_PLAYERS_MAX : BRACKET_PLAYERS_MAX;
  return Number.isInteger(players) && players >= playersMin(format) && players <= max;
}

/**
 * The most tie-break groups at the cut for the final: up to 1, or up to 3 from 11 players
 * (docs/PLAN.md, "Time estimate"). The 4, 3, 2, 1 table ties often, and a tie of more than 4
 * players needs 2 or more groups and then a second pass. Played out through the engine on
 * 2026-11-14 (2016 runs, 5 to 32 players, 1 to 3 rounds): up to 1 group with 10 players or
 * fewer, up to 3 from 11.
 */
const tieBreakGroups = (n: number): number => (n <= 10 ? 1 : 3);

/** The most waves the tie-break groups add: 1 pass up to 10 players, 2 passes after that (3 on one station, where each group is a wave). */
const tieBreakWaves = (n: number, stations: number): number => (n <= 10 ? 1 : stations === 1 ? 3 : 2);

/** Matches played, from the engine's own counts (docs/PLAN.md, "Time estimate"). */
function matchCount(plan: EventPlan, n: number): Range {
  switch (plan.format) {
    case 'single':
      // A 3rd-place match is played from 4 players.
      return exact(n - 1 + (n >= 4 ? 1 : 0));
    case 'double':
      // The rematch for the title is played only when the player from the losers' side wins the first final.
      return { low: 2 * n - 2, high: 2 * n - 1 };
    case 'round_robin': {
      const all = (n * (n - 1)) / 2;
      // Two players can't tie; from 3, a loop among three gives a tie-break round of 3 matches.
      return { low: all, high: all + (n >= 3 ? TIE_BREAK_MATCHES : 0) };
    }
    case 'heats': {
      if (!hasQualifying(n)) return exact(1);
      const qualifying = plan.rounds * Math.ceil(n / HEAT_SIZE_MAX) + 1;
      return { low: qualifying, high: qualifying + tieBreakGroups(n) };
    }
  }
}

const exact = (value: number): Range => ({ low: value, high: value });

/**
 * A round of an elimination bracket: how many real matches it holds (byes aren't matches)
 * and which rounds, by index, must be finished before it can start.
 */
interface Round {
  count: number;
  after: number[];
}

/**
 * The rounds of a single or double elimination bracket for `n` players, from the engine's
 * own layout (checked 2026-11-14 against `brackets-manager` for 2 to 32 players: the counts
 * add up to the match counts above, the rematch for the title not included).
 *
 * With `size` = the next power of two, `first` = n - size / 2 matches are real in round 1 of
 * the winners' side and the rest are byes. Later winners' rounds are full. Two lives adds the
 * losers' side: its round 1 pairs the round 1 losers, round 2 is the winners' round 1 and 2
 * losers against its round 1 survivors, and from round 3 each pair of rounds halves.
 */
function eliminationRounds(format: 'single' | 'double', n: number): Round[] {
  const rounds = log2Ceil(n);
  const size = 2 ** rounds;
  const first = n - size / 2;
  const winners = (k: number): number => (k === 1 ? first : size / 2 ** k);
  const list: Round[] = [];
  for (let k = 1; k <= rounds; k++) {
    // Single elimination plays the 3rd-place match with the final, from 4 players.
    const third = format === 'single' && k === rounds && n >= 4 ? 1 : 0;
    list.push({ count: winners(k) + third, after: k > 1 ? [k - 2] : [] });
  }
  if (format === 'single') return list;

  const losersRounds = 2 * rounds - 2;
  const losers = (j: number): number => {
    if (j === 1) return Math.max(0, first - size / 4);
    if (j === 2) return Math.min(first, size / 4);
    return size / 2 ** (Math.floor((j - 1) / 2) + 2);
  };
  // Round j of the losers' side is index `rounds + j - 1`; the winners' round k is index k - 1.
  for (let j = 1; j <= losersRounds; j++) {
    // An even round also takes the losers dropping from the winners' round j / 2 + 1.
    const after = j === 1 ? [0] : [rounds + j - 2, ...(j % 2 === 0 ? [j / 2] : [])];
    list.push({ count: losers(j), after });
  }
  list.push({ count: 1, after: [rounds - 1, rounds + losersRounds - 1] });
  return list;
}

/**
 * Waves for a list of rounds on `live` stations: each wave plays up to `live` matches from
 * the rounds that are ready, the ones that became ready first going first (the queue's order,
 * docs/PLAN.md, "Stations and the queue"). A round is ready once every round it needs ended
 * in an earlier wave. Rounds are treated as wholes, which is slightly stricter than the real
 * bracket, where a match needs only its two feeders.
 */
function simulateWaves(rounds: readonly Round[], live: number): number {
  const left = rounds.map((r) => r.count);
  const readyAt = new Map<number, number>();
  let waves = 0;
  while (left.some((count) => count > 0)) {
    const ready = left.flatMap((count, i) => (count > 0 && (rounds[i] as Round).after.every((d) => left[d] === 0) ? [i] : []));
    for (const i of ready) if (!readyAt.has(i)) readyAt.set(i, waves);
    // Array sort is stable, so rounds ready at the same wave keep their order.
    ready.sort((a, b) => (readyAt.get(a) as number) - (readyAt.get(b) as number));
    let room = live;
    for (const i of ready) {
      const played = Math.min(room, left[i] as number);
      left[i] = (left[i] as number) - played;
      room -= played;
      if (room === 0) break;
    }
    waves += 1;
  }
  return waves;
}

/**
 * Waves. The docs/PLAN.md formula, max(ceil(M / stations), the fewest rounds), undercounts
 * elimination: with 12 players and 3 stations it says 4 and the engine needs 6, because
 * round 1 has 4 matches and the next has 4 more, and each takes two waves on 3 stations.
 * So elimination is played out round by round (`simulateWaves`), which matched the engine
 * within max(1, 10%) for 2 to 32 players on 1, 2, 3, 4, and 8 stations except one case.
 * Everyone plays everyone has no rounds to wait for, so it keeps the formula.
 */
function waveCount(plan: EventPlan, n: number, matches: Range): Range {
  const { format, stations } = plan;
  if (format === 'heats') {
    if (!hasQualifying(n)) return exact(1);
    const perRound = Math.ceil(Math.ceil(n / HEAT_SIZE_MAX) / stations);
    const base = plan.rounds * perRound + 1;
    return { low: base, high: base + tieBreakWaves(n, stations) };
  }
  // At most floor(n / 2) matches can be played at once, whatever the stations.
  const live = Math.min(stations, Math.floor(n / 2));
  if (format === 'round_robin') {
    const rounds = n % 2 === 0 ? n - 1 : n;
    const low = Math.max(Math.ceil(matches.low / live), rounds);
    // A tie-break round is among 3 players, so its matches can't be played together.
    return { low, high: low + (matches.high - matches.low) };
  }
  const low = simulateWaves(eliminationRounds(format, n), live);
  // The rematch for the title is one more match after the final.
  return { low, high: low + (matches.high - matches.low) };
}

/** Minutes for one match or group. */
function minutesPerWave(plan: EventPlan): number {
  const games = plan.format === 'heats' ? plan.races : EXPECTED_GAMES[plan.bestOf];
  return plan.minutesPerGame * games + plan.changeoverMinutes;
}

/**
 * The estimate for `players` players, or null when the format can't start with that many
 * (the wizard then shows the problem words instead of a time).
 */
export function estimatePlan(plan: EventPlan, players: number): Estimate | null {
  if (!canEstimate(plan.format, players)) return null;
  const matches = matchCount(plan, players);
  const waves = waveCount(plan, players, matches);
  const each = minutesPerWave(plan);
  return { matches, waves, minutesPerWave: each, minutes: { low: waves.low * each, high: waves.high * each } };
}

/**
 * The minutes the screen shows: the nearest 5 under an hour and the nearest 15 from an hour
 * (so 279 minutes shows as 285, "4 hours 45 minutes"). Never below 5, so a short event
 * doesn't read "0 minutes".
 */
export function displayMinutes(minutes: number): number {
  const step = minutes < 60 ? 5 : 15;
  return Math.max(5, Math.round(minutes / step) * step);
}

/** True when the high end, before rounding, is more than the time the host has. */
export function isTooLong(estimate: Estimate, hours: number): boolean {
  return estimate.minutes.high > hours * 60;
}

/** A change that shortens the event. The warning shows at most two (`suggestFixes`). */
export type FixId = 'station' | 'one-life' | 'best-of-1' | 'bracket' | 'fewer-games' | 'one-round';

export interface Fix {
  id: FixId;
  /** The plan with the change made. */
  plan: EventPlan;
  /** The estimate for that plan. */
  estimate: Estimate;
  /** High-end minutes saved, not rounded. */
  savedMinutes: number;
}

/** How many fixes the warning shows. */
export const FIXES_MAX = 2;

/** The changes that apply to the plan, in the order docs/PLAN.md lists them. */
function candidates(plan: EventPlan): Array<[FixId, EventPlan]> {
  const list: Array<[FixId, EventPlan]> = [];
  if (plan.stations < STATIONS_MAX) list.push(['station', { ...plan, stations: plan.stations + 1 }]);
  if (plan.format === 'double') list.push(['one-life', { ...plan, format: 'single' }]);
  if (plan.format !== 'heats' && plan.bestOf !== 1) list.push(['best-of-1', { ...plan, bestOf: 1 }]);
  if (plan.format === 'round_robin' || plan.format === 'heats') list.push(['bracket', { ...plan, format: 'single' }]);
  if (plan.format === 'heats' && plan.races > 1) list.push(['fewer-games', { ...plan, races: 1 }]);
  if (plan.format === 'heats' && plan.rounds > 1) list.push(['one-round', { ...plan, rounds: 1 }]);
  return list;
}

/**
 * Up to two changes that save the most time, each worked out by running the estimate again.
 * A change that applies but saves nothing (a station when only one match can be played at a
 * time) is left out, and so is one the player count can't use. Ties keep the order of the
 * list in docs/PLAN.md. The client shows them only when `isTooLong`.
 */
export function suggestFixes(plan: EventPlan, players: number): Fix[] {
  const now = estimatePlan(plan, players);
  if (!now) return [];
  const fixes: Fix[] = [];
  for (const [id, changed] of candidates(plan)) {
    const estimate = estimatePlan(changed, players);
    if (!estimate) continue;
    const savedMinutes = now.minutes.high - estimate.minutes.high;
    if (savedMinutes > 0) fixes.push({ id, plan: changed, estimate, savedMinutes });
  }
  // Array sort is stable, so equal savings keep the candidate order.
  return fixes.sort((a, b) => b.savedMinutes - a.savedMinutes).slice(0, FIXES_MAX);
}
