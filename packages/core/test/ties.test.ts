// Round robin ranking and tie-breaks (src/ties.ts).

import { describe, expect, it } from 'vitest';
import { allPairs, rankRoundRobin, type MatchResult, type TieBreakResult } from '../src/index.ts';

/** Each pair is [winner, loser]. */
const beats = (...pairs: Array<[number, number]>): MatchResult[] => pairs.map(([winner, loser]) => ({ winner, loser }));
const inRound = (n: number, ...pairs: Array<[number, number]>): TieBreakResult[] =>
  pairs.map(([winner, loser]) => ({ winner, loser, round: n }));

/** Everyone earlier in the list beats everyone later. */
function ladder(order: number[]): MatchResult[] {
  return allPairs(order).map(([winner, loser]) => ({ winner, loser }));
}

const places = (players: number[], results: MatchResult[], tieBreaks: TieBreakResult[] = []) =>
  rankRoundRobin(players, results, tieBreaks).groups.map((g) => [g.place, ...g.players]);

describe('allPairs', () => {
  it('lists each pair once', () => {
    expect(allPairs([1, 2, 3])).toEqual([[1, 2], [1, 3], [2, 3]]);
    expect(allPairs([7])).toEqual([]);
  });
});

describe('rankRoundRobin', () => {
  it('orders by wins when nobody is level', () => {
    const ranking = rankRoundRobin([3, 1, 2], ladder([1, 2, 3]));
    expect(ranking.groups).toEqual([
      { place: 1, players: [1] },
      { place: 2, players: [2] },
      { place: 3, players: [3] },
    ]);
    expect(ranking.tieBreaks).toEqual([]);
  });

  it('settles a tie of two by the match between them, with no tie-break', () => {
    // 1 and 2 have two wins each, and so do 3 and 4 with one each; 2 beat 1, and 3 beat 4.
    const results = beats([2, 1], [1, 3], [1, 4], [2, 3], [4, 2], [3, 4]);
    const ranking = rankRoundRobin([1, 2, 3, 4], results);
    expect(ranking.groups.map((g) => g.players)).toEqual([[2], [1], [3], [4]]);
    expect(ranking.tieBreaks).toEqual([]);
  });

  it('asks for a tie-break round when three players loop for first', () => {
    // 1 beat 2, 2 beat 3, 3 beat 1, and all three beat 4.
    const results = beats([1, 2], [2, 3], [3, 1], [1, 4], [2, 4], [3, 4]);
    const ranking = rankRoundRobin([1, 2, 3, 4], results);
    expect(ranking.groups).toEqual([
      { place: 1, players: [1, 2, 3] },
      { place: 4, players: [4] },
    ]);
    expect(ranking.tieBreaks).toEqual([{ place: 1, players: [1, 2, 3], round: 1, pairs: [[1, 2], [1, 3], [2, 3]] }]);
  });

  it('uses the wins among only the tied players when three or more are level', () => {
    // 2, 3, and 4 each have 3 wins. Among themselves 2 beat 3 and 4, and 3 beat 4.
    const results = beats(
      ...([[1, 2], [1, 3], [4, 1], [1, 5], [1, 6], [2, 3], [2, 4], [5, 2], [2, 6], [3, 4], [3, 5], [3, 6], [4, 5], [4, 6], [5, 6]] as Array<[number, number]>),
    );
    const ranking = rankRoundRobin([1, 2, 3, 4, 5, 6], results);
    expect(ranking.groups.map((g) => [g.place, ...g.players])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]]);
    expect(ranking.tieBreaks).toEqual([]);
  });

  it('shares places below the podium when a loop sits there', () => {
    const results = [
      ...ladder([1, 2, 3, 4, 5, 6]).filter((r) => r.winner <= 3),
      ...beats([4, 5], [5, 6], [6, 4]),
    ];
    const ranking = rankRoundRobin([1, 2, 3, 4, 5, 6], results);
    expect(ranking.groups).toEqual([
      { place: 1, players: [1] },
      { place: 2, players: [2] },
      { place: 3, players: [3] },
      { place: 4, players: [4, 5, 6] },
    ]);
    expect(ranking.tieBreaks).toEqual([]);
  });

  it('asks for a tie-break when a loop touches 3rd place', () => {
    const results = [...ladder([1, 2, 3, 4, 5, 6]).filter((r) => r.winner <= 2), ...beats([3, 4], [4, 5], [5, 3], [3, 6], [4, 6], [5, 6])];
    const ranking = rankRoundRobin([1, 2, 3, 4, 5, 6], results);
    expect(ranking.tieBreaks).toEqual([{ place: 3, players: [3, 4, 5], round: 1, pairs: [[3, 4], [3, 5], [4, 5]] }]);
    const settled = rankRoundRobin([1, 2, 3, 4, 5, 6], results, inRound(1, [4, 3], [3, 5], [4, 5]));
    expect(settled.groups.map((g) => [g.place, ...g.players])).toEqual([[1, 1], [2, 2], [3, 4], [4, 3], [5, 5], [6, 6]]);
    expect(settled.tieBreaks).toEqual([]);
  });

  it('does not ask for a tie-break until every match has a result', () => {
    // Only 1 v 2 is played, so 2 and 3 are level and their match is still to come.
    const ranking = rankRoundRobin([1, 2, 3], beats([1, 2]));
    expect(ranking.tieBreaks).toEqual([]);
    expect(ranking.groups).toEqual([
      { place: 1, players: [1] },
      { place: 2, players: [2, 3] },
    ]);
  });

  it('puts an all-level group of five into one tie-break round of ten matches', () => {
    // Each player beats the next two around a circle.
    const circle = [1, 2, 3, 4, 5].flatMap((p) => [[p, (p % 5) + 1], [p, ((p + 1) % 5) + 1]] as Array<[number, number]>);
    const ranking = rankRoundRobin([1, 2, 3, 4, 5], beats(...circle));
    expect(ranking.groups).toEqual([{ place: 1, players: [1, 2, 3, 4, 5] }]);
    expect(ranking.tieBreaks).toHaveLength(1);
    expect(ranking.tieBreaks[0]?.pairs).toHaveLength(10);
  });

  it('finishes a tie-break round and plays the next one for whoever is still level', () => {
    const circle = [1, 2, 3, 4, 5].flatMap((p) => [[p, (p % 5) + 1], [p, ((p + 1) % 5) + 1]] as Array<[number, number]>);
    const main = beats(...circle);
    // Round 1: 1 beats everyone; 5 loses to everyone; 2, 3, 4 loop.
    const round1 = inRound(1, [1, 2], [1, 3], [1, 4], [1, 5], [2, 5], [3, 5], [4, 5], [2, 3], [3, 4], [4, 2]);
    const ranking = rankRoundRobin([1, 2, 3, 4, 5], main, round1);
    expect(ranking.groups).toEqual([
      { place: 1, players: [1] },
      { place: 2, players: [2, 3, 4] },
      { place: 5, players: [5] },
    ]);
    expect(ranking.tieBreaks).toEqual([{ place: 2, players: [2, 3, 4], round: 2, pairs: [[2, 3], [2, 4], [3, 4]] }]);

    const round2 = inRound(2, [3, 2], [3, 4], [2, 4]);
    expect(places([1, 2, 3, 4, 5], main, [...round1, ...round2])).toEqual([[1, 1], [2, 3], [3, 2], [4, 4], [5, 5]]);
  });

  it('repeats a tie-break round that is itself tied', () => {
    const results = beats([1, 2], [2, 3], [3, 1]);
    const loop = inRound(1, [2, 1], [3, 2], [1, 3]);
    const ranking = rankRoundRobin([1, 2, 3], results, loop);
    expect(ranking.groups).toEqual([{ place: 1, players: [1, 2, 3] }]);
    expect(ranking.tieBreaks).toEqual([{ place: 1, players: [1, 2, 3], round: 2, pairs: [[1, 2], [1, 3], [2, 3]] }]);
    // Round 2 settles it. A result from round 1 is not counted again.
    expect(places([1, 2, 3], results, [...loop, ...inRound(2, [1, 2], [1, 3], [2, 3])])).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it('keeps asking for a round that is only partly played', () => {
    const results = beats([1, 2], [2, 3], [3, 1]);
    const ranking = rankRoundRobin([1, 2, 3], results, inRound(1, [1, 2], [1, 3]));
    expect(ranking.tieBreaks).toEqual([{ place: 1, players: [1, 2, 3], round: 1, pairs: [[1, 2], [1, 3], [2, 3]] }]);
  });

  it('settles two groups that both touch the podium on their own rounds', () => {
    // 1, 2, 3 loop at the top; 4 and 5 and 6 loop below, starting at 4th (shared).
    const results = beats([1, 2], [2, 3], [3, 1], [4, 5], [5, 6], [6, 4], ...[1, 2, 3].flatMap((w) => [4, 5, 6].map((l): [number, number] => [w, l])));
    const ranking = rankRoundRobin([1, 2, 3, 4, 5, 6], results);
    expect(ranking.tieBreaks.map((t) => [t.place, t.round])).toEqual([[1, 1]]);
    expect(ranking.groups.at(-1)).toEqual({ place: 4, players: [4, 5, 6] });
  });

  it('works for two players', () => {
    expect(places([4, 9], beats([9, 4]))).toEqual([[1, 9], [2, 4]]);
  });
});
