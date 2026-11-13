// Undo (src/bracket-engine.ts, undoResult): the bracket comes back exactly as it was
// (CLAUDE.md, rule 5), and an older result comes off only when nothing later depends on it.

import { createSeededRandom, type BracketFormat, type BracketMatch } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { joinLate, startTieBreak } from '../src/bracket-engine.ts';
import { expectOk, handles, onStations, play, playOut, playOutInBatches, randomPick, start, step, undo, type Run } from './bracket-helpers.ts';

/** Undoes the newest result and checks the answer and the state are exactly the earlier ones. */
async function expectUndoRestores(before: Run, after: Run): Promise<void> {
  const last = after.state.results.at(-1);
  if (!last) throw new Error('nothing was recorded');
  const undone = expectOk(await undo(after.state, last.id));
  expect(undone.bracket).toEqual(before.bracket);
  expect(undone.state).toEqual(before.state);
}

describe('undo of the newest result', () => {
  // Every format at a spread of sizes, undoing after every single result. Every size is
  // played to a finish in the other bracket tests; replaying all of them here after every
  // result would take minutes.
  const cases: Array<[BracketFormat, number[]]> = [
    ['single', [2, 3, 4, 5, 7, 8, 9, 12, 16, 17, 32]],
    ['double', [3, 4, 5, 6, 8, 11, 16, 23, 32]],
    ['round_robin', [2, 3, 4, 5, 7, 8, 11]],
  ];
  for (const [format, sizes] of cases) {
    it(`restores the answer exactly after every result: ${format}, ${sizes.join(', ')} players`, async () => {
      let checks = 0;
      for (const n of sizes) {
        const random = createSeededRandom(n * 7);
        await playOut(await start(format, n, n, 1 + (n % 4)), random, randomPick(random), async (before, after) => {
          // A tie-break being made is a step too, but not a result.
          if (after.state.results.length === before.state.results.length) return;
          await expectUndoRestores(before, after);
          checks++;
        });
      }
      expect(checks).toBeGreaterThan(sizes.length);
    });
  }

  it('restores the answer exactly in a round robin of 32: at the start, halfway, and at the last result', async () => {
    // One seeded run; replaying after every one of 496 results would take minutes.
    const random = createSeededRandom(32);
    const pick = randomPick(random);
    const playOne = async (run: Run): Promise<Run> => {
      const match = onStations(run.bracket)[0] as BracketMatch;
      const after = await play(run, match, pick(match));
      await expectUndoRestores(run, after);
      return after;
    };
    let run = await playOne(await start('round_robin', 32, 32, 8));
    run = await playOne(await playOutInBatches(run, random, pick, (state) => state.results.length >= 248));
    // Up to one batch of 8 from the end, then one result at a time, so the last one is checked.
    run = await playOutInBatches(run, random, pick, (state) => state.results.length >= 496 - 8);
    while (onStations(run.bracket).length > 0) run = await playOne(run);
    expect(run.state.results.filter((r) => r.matchId < 1000)).toHaveLength(496);
  });

  it('restores the rematch for the title, and the final before it', async () => {
    let run = await start('double', 4, 3, 1);
    const random = createSeededRandom(4);
    while (!onStations(run.bracket).some((m) => m.side === 'final')) run = (await step(run, random, randomPick(random))) as Run;

    const final = onStations(run.bracket).find((m) => m.side === 'final') as BracketMatch;
    const afterFinal = await play(run, final, 1);
    expect(afterFinal.bracket.matches.find((m) => m.side === 'rematch')?.status).toBe('playing');
    await expectUndoRestores(run, afterFinal);

    const rematch = afterFinal.bracket.stations[0]?.match as BracketMatch;
    const afterRematch = await play(afterFinal, rematch, 0);
    expect(afterRematch.bracket.finished).toBe(true);
    await expectUndoRestores(afterFinal, afterRematch);

    // The unbeaten player winning the final: the rematch leaves the answer, and comes back on undo.
    const noRematch = await play(run, final, 0);
    expect(noRematch.bracket.finished).toBe(true);
    expect(noRematch.bracket.matches.some((m) => m.side === 'rematch')).toBe(false);
    await expectUndoRestores(run, noRematch);
  });

  it('restores a tie-break match and the tie it settled', async () => {
    // 3 players in a loop: 1 beats 2, 2 beats 3, 3 beats 1.
    const loop = new Set(['1-2', '2-3', '3-1']);
    const pick = (m: BracketMatch): 0 | 1 => {
      const [a, b] = m.slots.map((s) => s.player?.id);
      return m.side === 'tie-break' ? ((a as number) < (b as number) ? 0 : 1) : loop.has(`${a}-${b}`) ? 0 : 1;
    };
    let run = await start('round_robin', 3, 1, 1);
    while (onStations(run.bracket).length > 0) run = await play(run, onStations(run.bracket)[0] as BracketMatch, pick(onStations(run.bracket)[0] as BracketMatch));
    run = expectOk(await startTieBreak(run.state, handles));
    let checks = 0;
    await playOut(run, createSeededRandom(1), pick, async (before, after) => {
      await expectUndoRestores(before, after);
      checks++;
    });
    expect(checks).toBe(3);
  });

  it('keeps a late player in after an undo, and restores the answer from after the join', async () => {
    const run = await start('single', 5, 5, 2);
    const joined = expectOk(await joinLate(run.state, 40, handles));
    const random = createSeededRandom(1);
    await playOut(joined, random, randomPick(random), async (before, after) => {
      await expectUndoRestores(before, after);
      const undone = expectOk(await undo(after.state, after.state.results.at(-1)?.id as number));
      expect(undone.state.seeding).toContain(40);
    });
  });

  it('moves a later join back a step when the result before it comes off', async () => {
    // Two stations, both first-round matches called at the start. Record one, add a late
    // player, then undo that result: the join now counts from step 0.
    const run = await start('single', 6, 2, 2);
    const first = await play(run, run.bracket.stations[0]?.match as BracketMatch, 0);
    const joined = expectOk(await joinLate(first.state, 40, handles));
    expect(joined.state.lateJoins).toEqual([{ playerId: 40, step: 1 }]);
    const undone = expectOk(await undo(joined.state, first.state.results[0]?.id as number));
    expect(undone.state.lateJoins).toEqual([{ playerId: 40, step: 0 }]);
    expect(undone.state.results).toEqual([]);
  });
});

describe('undo of an older result', () => {
  /** Plays the match on the given station (from 0). */
  const playStation = (run: Run, index: number, winner: 0 | 1 = 0): Promise<Run> => play(run, run.bracket.stations[index]?.match as BracketMatch, winner);

  it('moves nothing being played, and an idle station takes the reopened match', async () => {
    // The review's case: 8 players, 3 stations. Matches 1 to 3 of round 1 start; match 4 waits.
    const run = await start('single', 8, 1, 3);
    const first = run.bracket.stations[0]?.match as BracketMatch;
    const afterFirst = await playStation(run, 0); // station 1 takes match 4
    const afterThird = await playStation(afterFirst, 2); // nothing waits, so station 3 goes idle
    expect(afterThird.bracket.stations[2]?.match).toBeNull();

    const undone = expectOk(await undo(afterThird.state, afterFirst.state.results[0]?.id as number));
    // Stations 1 and 2 keep their matches and their times; station 3 takes the reopened match now.
    expect(undone.bracket.stations.slice(0, 2)).toEqual(afterThird.bracket.stations.slice(0, 2));
    expect(undone.bracket.stations[2]).toMatchObject({ match: { id: first.id, status: 'playing', winner: null }, calledAt: undone.state.results[0]?.undone?.at });
    // The later result stands, and the undone one stays in the log.
    expect(undone.bracket.matches.find((m) => m.id === afterThird.state.results[1]?.matchId)?.status).toBe('done');
    expect(undone.state.results).toHaveLength(2);
    expect(undone.state.results[0]?.undone).toEqual({ step: 2, at: undone.bracket.stations[2]?.calledAt });
  });

  it('puts the reopened match at the front of Up next when every station is busy', async () => {
    // Everyone plays everyone, 6 players, 2 stations: many matches wait.
    const run = await start('round_robin', 6, 2, 2);
    const a = await playStation(run, 0);
    const b = await playStation(a, 1);
    const undone = expectOk(await undo(b.state, a.state.results[0]?.id as number));
    expect(undone.bracket.stations).toEqual(b.bracket.stations);
    expect(undone.bracket.upNext[0]?.id).toBe(a.state.results[0]?.matchId);
    expect(undone.bracket.upNext.slice(1).map((m) => m.id)).toEqual(b.bracket.upNext.map((m) => m.id));
  });

  it('is allowed when a later match was called only because its station was free', async () => {
    // One station: B was called when A's result freed it, but B's players don't come from A.
    const run = await start('single', 8, 1, 1);
    const afterA = await playStation(run, 0);
    const afterB = await playStation(afterA, 0);
    const undone = expectOk(await undo(afterB.state, afterA.state.results[0]?.id as number));
    expect(undone.bracket.stations).toEqual(afterB.bracket.stations);
    expect(undone.bracket.upNext[0]?.id).toBe(afterA.state.results[0]?.matchId);
  });

  it('is refused when a later result was played by the winner it would take away', async () => {
    const run = await start('single', 4, 1, 2);
    const [a, b] = onStations(run.bracket) as [BracketMatch, BracketMatch];
    let current = await play(await play(run, a, 0), b, 0);
    const final = onStations(current.bracket)[0] as BracketMatch;
    current = await play(current, final, 0);
    const firstId = current.state.results[0]?.id as number;
    expect(await undo(current.state, firstId)).toEqual({ ok: false, error: 'undo-later-first' });
  });

  it('is refused when a match being played has the winner it would take away', async () => {
    // 4 players, 2 stations: both semi-finals played, so the final and the 3rd-place match are on.
    const run = await start('single', 4, 1, 2);
    const afterA = await playStation(run, 0);
    const afterB = await playStation(afterA, 1);
    expect(onStations(afterB.bracket).map((m) => m.side).sort()).toEqual(['main', 'third']);
    expect(await undo(afterB.state, afterA.state.results[0]?.id as number)).toEqual({ ok: false, error: 'undo-later-first' });
  });

  it('is refused once a tie-break was made after it', async () => {
    const loop = new Set(['1-2', '2-3', '3-1']);
    let run = await start('round_robin', 3, 1, 1);
    while (onStations(run.bracket).length > 0) {
      const m = onStations(run.bracket)[0] as BracketMatch;
      run = await play(run, m, loop.has(`${m.slots[0].player?.id}-${m.slots[1].player?.id}`) ? 0 : 1);
    }
    run = expectOk(await startTieBreak(run.state, handles));
    expect(await undo(run.state, run.state.results[0]?.id as number)).toEqual({ ok: false, error: 'undo-later-first' });
  });

  it('takes back a result whose match it fed was undone first, and restores exactly after that', async () => {
    // 16 players, one station. Round 1 (8 matches), then the first two of round 2.
    let run = await start('single', 16, 3, 1);
    for (let i = 0; i < 10; i++) run = await playStation(run, 0);
    const feeder = run.state.results[0] as { id: number; matchId: number };
    const fed = run.state.results[8] as { id: number; matchId: number };
    expect(run.bracket.matches.find((m) => m.id === fed.matchId)).toMatchObject({ round: 2, number: 1 });

    // Undo the first match of round 2 while round 2's third is on the station: it reopens.
    const reopened = expectOk(await undo(run.state, fed.id));
    expect(reopened.bracket.stations).toEqual(run.bracket.stations);
    expect(reopened.bracket.upNext[0]?.id).toBe(fed.matchId);

    // Then the round 1 match that fed it: the round 2 match loses a player and leaves Up next.
    const both = expectOk(await undo(reopened.state, feeder.id));
    expect(both.bracket.stations).toEqual(run.bracket.stations);
    expect(both.bracket.upNext[0]?.id).toBe(feeder.matchId);
    expect(both.bracket.upNext.map((m) => m.id)).not.toContain(fed.matchId);
    expect(both.bracket.matches.find((m) => m.id === fed.matchId)?.status).toBe('waiting');

    // The station frees and takes the reopened match; its new result is undone exactly.
    const next = await playStation(both, 0);
    expect(next.bracket.stations[0]?.match?.id).toBe(feeder.matchId);
    const replayed = await playStation(next, 0, 1);
    await expectUndoRestores(next, replayed);

    const random = createSeededRandom(8);
    const done = await playOut(replayed, random, randomPick(random));
    expect(done.bracket.finished).toBe(true);
    expect(done.bracket.standings.slice(0, 3).map((r) => r.place)).toEqual([1, 2, 3]);
  });

  it('answers nothing-to-undo for a result missing from the log, or already undone', async () => {
    const run = await start('round_robin', 6, 2, 2);
    expect(await undo(run.state, 1)).toEqual({ ok: false, error: 'nothing-to-undo' });
    const played = await playStation(await playStation(run, 0), 1);
    expect(await undo(played.state, 999)).toEqual({ ok: false, error: 'nothing-to-undo' });
    const first = played.state.results[0]?.id as number;
    const undone = expectOk(await undo(played.state, first));
    expect(await undo(undone.state, first)).toEqual({ ok: false, error: 'nothing-to-undo' });
  });
});
