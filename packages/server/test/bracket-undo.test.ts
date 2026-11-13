// Undo (src/bracket-engine.ts, undoResult): the bracket comes back exactly as it was
// (CLAUDE.md, rule 5), and an older result comes off only when nothing later depends on it.

import { createSeededRandom, type BracketFormat, type BracketMatch } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { joinLate, startTieBreak, undoResult } from '../src/bracket-engine.ts';
import { expectOk, handles, onStations, play, playOut, randomPick, start, step, type Run } from './bracket-helpers.ts';

/** Undoes the newest result and checks the answer and the state are exactly the earlier ones. */
async function expectUndoRestores(before: Run, after: Run): Promise<void> {
  const last = after.state.results.at(-1);
  if (!last) throw new Error('nothing was recorded');
  const undone = expectOk(await undoResult(after.state, last.id, handles));
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
      const undone = expectOk(await undoResult(after.state, after.state.results.at(-1)?.id as number, handles));
      expect(undone.state.seeding).toContain(40);
    });
  });

  it('moves a later join back a step when an older result comes off', async () => {
    // Two stations, both first-round matches called at the start. Record one, add a late
    // player, then undo that result: the join now counts from step 0.
    const run = await start('single', 6, 2, 2);
    const first = await play(run, run.bracket.stations[0]?.match as BracketMatch, 0);
    const joined = expectOk(await joinLate(first.state, 40, handles));
    expect(joined.state.lateJoins).toEqual([{ playerId: 40, step: 1 }]);
    const undone = expectOk(await undoResult(joined.state, first.state.results[0]?.id as number, handles));
    expect(undone.state.lateJoins).toEqual([{ playerId: 40, step: 0 }]);
    expect(undone.state.results).toEqual([]);
  });
});

describe('undo of an older result', () => {
  it('works when nothing later depends on it', async () => {
    // 8 players, two stations: matches 1 and 2 of round 1 start together.
    const run = await start('single', 8, 1, 2);
    const [a, b] = onStations(run.bracket) as [BracketMatch, BracketMatch];
    const afterA = await play(run, a, 0);
    const afterB = await play(afterA, b, 1);
    const undone = expectOk(await undoResult(afterB.state, afterA.state.results[0]?.id as number, handles));
    expect(undone.state.results).toEqual([afterB.state.results[1]]);
    // A is back on station 1 from the start; B keeps its result; B's station took the first
    // match that was waiting at the start.
    expect(undone.bracket.stations[0]).toEqual({ ...run.bracket.stations[0], match: { ...a, status: 'playing' } });
    expect(undone.bracket.matches.find((m) => m.id === b.id)).toMatchObject({ status: 'done', winner: 1 });
    expect(undone.bracket.stations[1]?.match?.id).toBe(run.bracket.upNext[0]?.id);
  });

  it('is refused when a later result was played by the winner it would take away', async () => {
    const run = await start('single', 4, 1, 2);
    const [a, b] = onStations(run.bracket) as [BracketMatch, BracketMatch];
    let current = await play(await play(run, a, 0), b, 0);
    const final = onStations(current.bracket)[0] as BracketMatch;
    current = await play(current, final, 0);
    const firstId = current.state.results[0]?.id as number;
    expect(await undoResult(current.state, firstId, handles)).toEqual({ ok: false, error: 'undo-later-first' });
  });

  it('is refused when a later result was for a match called only because of it', async () => {
    // One station: B was called only when A's result freed the station.
    const run = await start('single', 8, 1, 1);
    const afterA = await play(run, onStations(run.bracket)[0] as BracketMatch, 0);
    const afterB = await play(afterA, onStations(afterA.bracket)[0] as BracketMatch, 0);
    expect(await undoResult(afterB.state, afterA.state.results[0]?.id as number, handles)).toEqual({ ok: false, error: 'undo-later-first' });
  });

  it('answers nothing-to-undo for a result missing from the log', async () => {
    const run = await start('single', 4, 1, 1);
    expect(await undoResult(run.state, 1, handles)).toEqual({ ok: false, error: 'nothing-to-undo' });
    const played = await play(run, onStations(run.bracket)[0] as BracketMatch, 0);
    expect(await undoResult(played.state, 999, handles)).toEqual({ ok: false, error: 'nothing-to-undo' });
  });
});
