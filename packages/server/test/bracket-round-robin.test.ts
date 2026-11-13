// Round robin through the engine (src/bracket-engine.ts): every size to a finish, and ties
// for places 1 to 3 played off in tie-break rounds (docs/PLAN.md, "Ties").

import { createSeededRandom, type Bracket, type BracketMatch } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { bracketAnswer, startTieBreak } from '../src/bracket-engine.ts';
import { expectOk, expectPodium, handles, onStations, play, playOutInBatches, randomPick, start, undo, type Run } from './bracket-helpers.ts';

const TIE_BREAK = 'tie-break';

/**
 * Plays every match on a station whose winner `beats` decides, until nothing is on a station.
 * `beats(a, b)` is true when player a beats player b.
 */
async function playAll(run: Run, beats: (a: number, b: number) => boolean): Promise<Run> {
  let current = run;
  for (;;) {
    const match = onStations(current.bracket)[0];
    if (!match) return current;
    const [a, b] = match.slots.map((s) => s.player?.id as number);
    current = await play(current, match, beats(a as number, b as number) ? 0 : 1);
  }
}

/** A beats B, B beats C, C beats A; anyone else loses to all three and to lower ids. */
const loopOf =
  (loop: readonly [number, number, number]) =>
  (a: number, b: number): boolean => {
    const [x, y, z] = loop;
    const wins: Record<string, true> = { [`${x}-${y}`]: true, [`${y}-${z}`]: true, [`${z}-${x}`]: true };
    if (loop.includes(a) && loop.includes(b)) return wins[`${a}-${b}`] === true;
    if (loop.includes(a)) return true;
    if (loop.includes(b)) return false;
    return a < b;
  };

const places = (bracket: Bracket): Array<[number, number]> => bracket.standings.map((r) => [r.place, r.player.id]);
const tieBreakMatches = (bracket: Bracket): BracketMatch[] => bracket.matches.filter((m) => m.side === TIE_BREAK);

describe('round robin sizes', () => {
  it('plays every size from 2 to 32 to a finish with n(n - 1) / 2 results, settling places 1 to 3', async () => {
    let tieBreaksPlayed = 0;
    for (let n = 2; n <= 32; n++) {
      const random = createSeededRandom(n);
      const run = await playOutInBatches(await start('round_robin', n, n, n >= 12 ? 8 : 1 + (n % 8)), random, randomPick(random));
      expect(run.bracket.finished, `n=${n}`).toBe(true);
      const own = run.state.results.filter((r) => r.matchId < 1000);
      expect(own, `n=${n}`).toHaveLength((n * (n - 1)) / 2);
      tieBreaksPlayed += run.state.results.length - own.length;
      expect(run.bracket.ties).toEqual([]);
      expectPodium(run.bracket, n);
      // An odd count has one bye a round; nobody plays a bye.
      expect(run.bracket.matches.filter((m) => m.status === 'bye')).toHaveLength(n % 2 === 1 ? n : 0);
    }
    // Random play ties at the top often enough that the run above plays tie-breaks.
    expect(tieBreaksPlayed).toBeGreaterThan(0);
  });

  it('rebuilds 32 players from the full log of 496 results in well under a second', async () => {
    const random = createSeededRandom(32);
    const run = await playOutInBatches(await start('round_robin', 32, 32, 8), random, randomPick(random));
    const started = performance.now();
    await bracketAnswer(run.state, handles);
    // About 50 to 80 ms on the dev box (2026-11-13); the bound leaves room for a slow CI runner.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('round robin ties', () => {
  it('settles ties of two by the match between them, with no tie-break', async () => {
    // 1 and 2 have 2 wins each and 1 beat 2; 3 and 4 have 1 win each and 3 beat 4.
    const wins = new Set(['1-2', '1-3', '2-3', '2-4', '4-1', '3-4']);
    const run = await playAll(await start('round_robin', 4, 1, 2), (a, b) => wins.has(`${a}-${b}`));
    expect(run.bracket.finished).toBe(true);
    expect(run.bracket.ties).toEqual([]);
    expect(places(run.bracket)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it('plays a three-way loop for 1st off in a tie-break round', async () => {
    let run = await playAll(await start('round_robin', 3, 1, 2), loopOf([1, 2, 3]));
    expect(run.bracket.finished).toBe(false);
    expect(run.bracket.ties).toHaveLength(1);
    expect(run.bracket.ties[0]).toMatchObject({ place: 1, started: false });
    expect(run.bracket.ties[0]?.players.map((p) => p.id).sort()).toEqual([1, 2, 3]);
    expect(run.bracket.ties[0]?.players[0]).toEqual({ id: run.bracket.ties[0]?.players[0]?.id, handle: `Player${run.bracket.ties[0]?.players[0]?.id}` });
    expect(run.bracket.standings.every((r) => r.place === 1)).toBe(true);

    run = expectOk(await startTieBreak(run.state, handles));
    expect(run.bracket.ties[0]?.started).toBe(true);
    expect(tieBreakMatches(run.bracket)).toHaveLength(3);
    expect(tieBreakMatches(run.bracket).every((m) => m.round === 1)).toBe(true);
    expect(await startTieBreak(run.state, handles)).toEqual({ ok: false, error: 'no-tie' });

    // The tie-break goes 1 over 2 over 3.
    run = await playAll(run, (a, b) => a < b);
    expect(run.bracket.finished).toBe(true);
    expect(run.bracket.ties).toEqual([]);
    expect(places(run.bracket)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    // Tie-break wins count: 1 won 1 in the round robin and 2 in the tie-break.
    expect(run.bracket.standings[0]).toMatchObject({ wins: 3, losses: 1 });
  });

  it('plays a tie-break round that is itself tied again, until each place has one player', async () => {
    let run = await playAll(await start('round_robin', 3, 2, 1), loopOf([1, 2, 3]));
    run = expectOk(await startTieBreak(run.state, handles));
    run = await playAll(run, loopOf([2, 3, 1]));
    expect(run.bracket.finished).toBe(false);
    expect(run.bracket.ties.map((t) => [t.place, t.players.length, t.started])).toEqual([[1, 3, false]]);

    run = expectOk(await startTieBreak(run.state, handles));
    expect(tieBreakMatches(run.bracket).map((m) => [m.round, m.number])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    run = await playAll(run, (a, b) => a > b);
    expect(run.bracket.finished).toBe(true);
    expect(places(run.bracket)).toEqual([
      [1, 3],
      [2, 2],
      [3, 1],
    ]);
  });

  it('plays off a loop for 2nd and leaves a loop below 3rd shared', async () => {
    // 7 players: 1 beats everyone; 2, 3, 4 loop and beat 5 to 7; 5, 6, 7 loop.
    const top = loopOf([2, 3, 4]);
    const bottom = loopOf([5, 6, 7]);
    const beats = (a: number, b: number): boolean => {
      if (a === 1 || b === 1) return a === 1;
      if (a <= 4 || b <= 4) return a <= 4 && b <= 4 ? top(a, b) : a <= 4;
      return bottom(a, b);
    };
    let run = await playAll(await start('round_robin', 7, 3, 3), beats);
    expect(run.bracket.ties.map((t) => [t.place, t.players.map((p) => p.id).sort()])).toEqual([[2, [2, 3, 4]]]);
    run = expectOk(await startTieBreak(run.state, handles));
    run = await playAll(run, (a, b) => a < b);
    expect(run.bracket.finished).toBe(true);
    expect(places(run.bracket).map(([place]) => place)).toEqual([1, 2, 3, 4, 5, 5, 5]);
  });

  it('plays a three-way loop for 3rd off in a tie-break round', async () => {
    // 5 players: 1 beats everyone, 2 beats everyone but 1, and 3, 4, 5 loop.
    const loop = loopOf([3, 4, 5]);
    const beats = (a: number, b: number): boolean => (a <= 2 || b <= 2 ? a < b : loop(a, b));
    let run = await playAll(await start('round_robin', 5, 4, 2), beats);
    expect(run.bracket.finished).toBe(false);
    expect(run.bracket.ties.map((t) => [t.place, t.players.map((p) => p.id).sort(), t.started])).toEqual([[3, [3, 4, 5], false]]);
    expect(places(run.bracket).slice(0, 2)).toEqual([
      [1, 1],
      [2, 2],
    ]);

    run = expectOk(await startTieBreak(run.state, handles));
    expect(tieBreakMatches(run.bracket)).toHaveLength(3);
    run = await playAll(run, (a, b) => a > b);
    expect(run.bracket.finished).toBe(true);
    expect(places(run.bracket)).toEqual([
      [1, 1],
      [2, 2],
      [3, 5],
      [4, 4],
      [5, 3],
    ]);
  });

  it('refuses a tie-break with no tie, and before every match has a result', async () => {
    const run = await start('round_robin', 3, 1, 1);
    expect(await startTieBreak(run.state, handles)).toEqual({ ok: false, error: 'no-tie' });
    const played = await playAll(run, (a, b) => a < b);
    expect(await startTieBreak(played.state, handles)).toEqual({ ok: false, error: 'no-tie' });
  });

  it('drops tie-break matches with no result when the result they came from is undone', async () => {
    const before = await (async () => {
      let run = await start('round_robin', 3, 1, 2);
      const loop = loopOf([1, 2, 3]);
      for (let i = 0; i < 2; i++) {
        const match = onStations(run.bracket)[0] as BracketMatch;
        const [a, b] = match.slots.map((s) => s.player?.id as number);
        run = await play(run, match, loop(a as number, b as number) ? 0 : 1);
      }
      return run;
    })();
    const done = await playAll(before, loopOf([1, 2, 3]));
    const made = expectOk(await startTieBreak(done.state, handles));
    const last = done.state.results.at(-1)?.id as number;
    const undone = expectOk(await undo(made.state, last));
    expect(undone.state.tieBreaks).toEqual([]);
    expect(undone.bracket).toEqual(before.bracket);
  });
});

