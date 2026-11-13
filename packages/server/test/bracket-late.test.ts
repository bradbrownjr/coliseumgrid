// Late sign-up (src/bracket-engine.ts, joinLate; docs/PLAN.md, "Late sign-up"): a late player
// takes a first-round bye or a round robin's empty slot, and nothing an on-time player has
// played or been called to changes.

import { createSeededRandom, type Bracket, type BracketFormat, type BracketMatch } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { joinLate } from '../src/bracket-engine.ts';
import { expectOk, handles, onStations, play, playOut, randomPick, start, step, type Run } from './bracket-helpers.ts';

const LATE = 40;

const playersOf = (m: BracketMatch): Array<number | null> => m.slots.map((s) => s.player?.id ?? null);
const withPlayer = (bracket: Bracket, id: number): BracketMatch[] => bracket.matches.filter((m) => playersOf(m).includes(id));

/** Every match with a result or on a station is the same match, with the same players, after the join. */
function expectOnTimeUnchanged(before: Bracket, after: Bracket): void {
  for (const m of before.matches) {
    if (m.status !== 'done' && m.status !== 'playing') continue;
    expect(after.matches.find((x) => x.id === m.id), `match ${m.id}`).toEqual(m);
  }
  before.stations.forEach((s, i) => {
    if (s.match) expect(after.stations[i]).toEqual(s);
  });
}

describe('late sign-up in elimination', () => {
  it('fills a bye, and the late player plays the one who would have moved on', async () => {
    // 5 players in 8 slots: seeds 1 to 3 have byes.
    const run = await start('single', 5, 5, 2);
    expect(run.bracket.lateOpen).toBe(true);
    const joined = expectOk(await joinLate(run.state, LATE, handles));
    expect(joined.state.seeding.filter((id) => id === null)).toHaveLength(2);
    expect(joined.state.lateJoins).toEqual([{ playerId: LATE, step: 0 }]);
    expectOnTimeUnchanged(run.bracket, joined.bracket);

    // The late player's match is a first-round match that was a bye, against its player.
    const [first] = withPlayer(joined.bracket, LATE);
    const bye = run.bracket.matches.find((m) => m.id === first?.id) as BracketMatch;
    expect(first).toMatchObject({ side: 'main', round: 1, status: 'playing' });
    expect(bye.status).toBe('bye');
    const byePlayer = playersOf(bye).find((id) => id !== null);
    expect(playersOf(first as BracketMatch)).toContain(byePlayer);
    // Station 2 sat idle behind the bye hold-back, so it takes the late player's match.
    expect(joined.bracket.stations[1]?.match?.id).toBe(first?.id);

    const random = createSeededRandom(5);
    const done = await playOut(joined, random, randomPick(random));
    expect(done.bracket.finished).toBe(true);
    expect(done.bracket.matches.find((m) => m.id === first?.id)?.status).toBe('done');
    expect(done.bracket.standings).toHaveLength(6);
  });

  it('takes a second late player into the next bye, in two lives too', async () => {
    const run = await start('double', 6, 6, 2);
    const one = expectOk(await joinLate(run.state, LATE, handles));
    const two = expectOk(await joinLate(one.state, LATE - 1, handles));
    expectOnTimeUnchanged(run.bracket, one.bracket);
    expectOnTimeUnchanged(one.bracket, two.bracket);
    expect(two.bracket.lateOpen).toBe(false);
    expect(await joinLate(two.state, LATE - 2, handles)).toEqual({ ok: false, error: 'late-closed' });
    const random = createSeededRandom(6);
    const done = await playOut(two, random, randomPick(random));
    expect(done.state.results).toHaveLength(2 * 8 - 2 + (done.bracket.matches.some((m) => m.side === 'rematch') ? 1 : 0));
  });

  it('is refused with no bye left', async () => {
    const run = await start('single', 8, 1, 2);
    expect(run.bracket.lateOpen).toBe(false);
    expect(await joinLate(run.state, LATE, handles)).toEqual({ ok: false, error: 'late-closed' });
  });

  it('is refused once round 1 is finished', async () => {
    // 6 players in 8 slots: two real first-round matches, both called at the start.
    let run = await start('single', 6, 6, 2);
    const firstRound = onStations(run.bracket);
    run = await play(run, firstRound[0] as BracketMatch, 0);
    expect(run.bracket.lateOpen).toBe(true);
    run = await play(run, firstRound[1] as BracketMatch, 0);
    expect(run.state.seeding).toContain(null);
    expect(run.bracket.lateOpen).toBe(false);
    expect(await joinLate(run.state, LATE, handles)).toEqual({ ok: false, error: 'late-closed' });
  });

  it('is refused when a match already called would change', async () => {
    // Two lives, 15 players in 16 slots, two stations, played to 10 results by a fixed seed.
    // Filling the bye makes a real match of the losers' side bye that fed the losers' round 2
    // match on station 1, so that match would lose a player.
    let run = await start('double', 15, 3, 2);
    const random = createSeededRandom(3 * 100 + 15);
    while (run.state.results.length < 10) run = (await step(run, random, randomPick(random))) as Run;
    expect(run.state.seeding).toContain(null);
    expect(run.bracket.matches.some((m) => m.side === 'winners' && m.round === 1 && m.status !== 'bye' && m.status !== 'done')).toBe(true);
    expect(run.bracket.stations[0]?.match).toMatchObject({ side: 'losers', round: 2 });
    expect(run.bracket.lateOpen).toBe(false);
    expect(await joinLate(run.state, LATE, handles)).toEqual({ ok: false, error: 'late-closed' });

    // Once that match has a result, the join would change a result, and is still refused.
    const recorded = await play(run, run.bracket.stations[0]?.match as BracketMatch, 0);
    expect(await joinLate(recorded.state, LATE, handles)).toEqual({ ok: false, error: 'late-closed' });
  });

  it('refuses a player already in the bracket, and one with no handle', async () => {
    const run = await start('single', 5, 5, 2);
    expect(await joinLate(run.state, run.state.seeding[0] as number, handles)).toEqual({ ok: false, error: 'already-in' });
    expect(await joinLate(run.state, 99, handles)).toEqual({ ok: false, error: 'not-found' });
  });

  it('never changes a recorded or called match, over random play with join attempts', async () => {
    let accepted = 0;
    let refused = 0;
    for (const format of ['single', 'double'] as BracketFormat[]) {
      for (const n of [3, 5, 6, 9, 11, 13, 17, 21]) {
        const random = createSeededRandom(n * 31);
        let run: Run | null = await start(format, n, n, 1 + (n % 4));
        let next = LATE;
        while (run) {
          if (random() < 0.3) {
            const answer = await joinLate(run.state, next, handles);
            expect(answer.ok).toBe(run.bracket.lateOpen);
            if (answer.ok) {
              expectOnTimeUnchanged(run.bracket, answer.bracket);
              run = { state: answer.state, bracket: answer.bracket };
              next--;
              accepted++;
            } else {
              expect(answer.error).toBe('late-closed');
              refused++;
            }
          }
          run = await step(run, random, randomPick(random));
        }
      }
    }
    expect(accepted).toBeGreaterThan(5);
    expect(refused).toBeGreaterThan(5);
  });
});

describe('late sign-up in a round robin', () => {
  it('fills the empty slot of an odd count, so the one who sat out each round plays them', async () => {
    const run = await start('round_robin', 5, 5, 2);
    expect(run.bracket.lateOpen).toBe(true);
    const random = createSeededRandom(5);
    const played = (await step(run, random, randomPick(random))) as Run;
    const joined = expectOk(await joinLate(played.state, LATE, handles));
    expectOnTimeUnchanged(played.bracket, joined.bracket);
    // Every on-time pairing keeps its round and number; the byes became the late player's matches.
    for (const m of played.bracket.matches) {
      const now = joined.bracket.matches.find((x) => x.id === m.id) as BracketMatch;
      expect([now.round, now.number]).toEqual([m.round, m.number]);
      if (m.status === 'bye') expect(playersOf(now)).toContain(LATE);
      else expect(playersOf(now)).toEqual(playersOf(m));
    }
    expect(withPlayer(joined.bracket, LATE)).toHaveLength(5);
    expect(joined.bracket.matches.some((m) => m.status === 'bye')).toBe(false);
    // The late player's matches queue behind those already waiting.
    const waitingBefore = played.bracket.upNext.map((m) => m.id);
    expect(joined.bracket.upNext.map((m) => m.id).slice(0, waitingBefore.length)).toEqual(waitingBefore.filter((id) => joined.bracket.upNext.some((m) => m.id === id)));

    const done = await playOut(joined, random, randomPick(random));
    expect(done.bracket.finished).toBe(true);
    expect(done.state.results.filter((r) => r.matchId < 1000)).toHaveLength(15);
  });

  it('is refused with an even count', async () => {
    const run = await start('round_robin', 4, 4, 2);
    expect(run.bracket.lateOpen).toBe(false);
    expect(await joinLate(run.state, LATE, handles)).toEqual({ ok: false, error: 'late-closed' });
  });

  it('is refused once round 1 is finished', async () => {
    let run = await start('round_robin', 5, 5, 2);
    const random = createSeededRandom(1);
    while (run.bracket.matches.some((m) => m.round === 1 && m.status !== 'done' && m.status !== 'bye')) {
      run = (await step(run, random, randomPick(random))) as Run;
    }
    expect(run.bracket.lateOpen).toBe(false);
    expect(await joinLate(run.state, LATE, handles)).toEqual({ ok: false, error: 'late-closed' });
  });
});
