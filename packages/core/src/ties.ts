// Round robin ranking and tie-breaks (docs/PLAN.md, "Ties"). Places 1 to 3 are prizes and
// are never shared, so a tie that touches them is played off; a tie further down is shared.
//
// Order: wins; then, among players level on wins, the wins they have against each other
// (the head-to-head winner for two, a mini-league for three or more), applied again to
// whoever is still level. A group that nothing separates (a loop, or all level) plays a
// tie-break round: everyone in the group plays everyone in it once, best of 1. A round
// that leaves a group level plays again.

export const PODIUM_PLACES = 3;

export interface MatchResult {
  winner: number;
  loser: number;
}

/** A tie-break result. `round` counts the group's tie-break rounds from 1. */
export interface TieBreakResult extends MatchResult {
  round: number;
}

/** Players level on `place`; they share places `place` to `place + players.length - 1`. */
export interface RankedGroup {
  place: number;
  players: number[];
}

/** A group that has to play, or is playing, tie-break round `round`. */
export interface TieBreakNeeded extends RankedGroup {
  round: number;
  /** Every match of the round. The server makes the ones it hasn't made yet. */
  pairs: Array<[number, number]>;
}

export interface RoundRobinRanking {
  /** Best first. Groups of one are settled; larger groups share places. */
  groups: RankedGroup[];
  /** Empty until every match of the round robin has a result. */
  tieBreaks: TieBreakNeeded[];
}

/** Every pair of the players once, in list order. */
export function allPairs(players: readonly number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  players.forEach((a, i) => {
    for (const b of players.slice(i + 1)) pairs.push([a, b]);
  });
  return pairs;
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Splits a group by the wins its members have against each other, most wins first. */
function splitByWins(group: readonly number[], results: readonly MatchResult[]): number[][] {
  const members = new Set(group);
  const wins = new Map(group.map((id) => [id, 0]));
  for (const { winner, loser } of results) {
    if (members.has(winner) && members.has(loser)) wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  const counts = [...new Set(wins.values())].sort((a, b) => b - a);
  return counts.map((count) => group.filter((id) => wins.get(id) === count));
}

/** The group in order, as far as the results go. A part that nothing separates stays whole. */
function rankGroup(group: readonly number[], results: readonly MatchResult[]): number[][] {
  const parts = splitByWins(group, results);
  if (parts.length === 1) return [[...group]];
  return parts.flatMap((part) => rankGroup(part, results));
}

function coversEveryPair(pairs: ReadonlyArray<readonly [number, number]>, results: readonly MatchResult[]): boolean {
  const done = new Set(results.map(({ winner, loser }) => pairKey(winner, loser)));
  return pairs.every(([a, b]) => done.has(pairKey(a, b)));
}

/**
 * Ranks a round robin. `results` holds the round robin's own matches; `tieBreakResults`
 * holds the tie-break matches. Before every match has a result the order is provisional
 * and no tie-break is asked for.
 */
export function rankRoundRobin(
  players: readonly number[],
  results: readonly MatchResult[],
  tieBreakResults: readonly TieBreakResult[] = [],
): RoundRobinRanking {
  const tiers = rankGroup(players, results);
  const groups: RankedGroup[] = [];
  const tieBreaks: TieBreakNeeded[] = [];
  const complete = coversEveryPair(allPairs(players), results);

  const place = (tier: readonly number[], first: number, round: number): void => {
    const pairs = allPairs(tier);
    if (!complete || tier.length < 2 || first > PODIUM_PLACES) {
      groups.push({ place: first, players: [...tier] });
      return;
    }
    const played = tieBreakResults.filter((r) => r.round === round && tier.includes(r.winner) && tier.includes(r.loser));
    if (!coversEveryPair(pairs, played)) {
      groups.push({ place: first, players: [...tier] });
      tieBreaks.push({ place: first, players: [...tier], round, pairs });
      return;
    }
    // The round is over: split by it, and play the next round for any part still level.
    let next = first;
    for (const part of rankGroup(tier, played)) {
      place(part, next, round + 1);
      next += part.length;
    }
  };

  let first = 1;
  for (const tier of tiers) {
    place(tier, first, 1);
    first += tier.length;
  }
  return { groups, tieBreaks };
}
