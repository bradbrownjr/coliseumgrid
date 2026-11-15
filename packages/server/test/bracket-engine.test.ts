// The bracket engine (src/bracket-engine.ts): single and double elimination at every size,
// the 3rd-place match, the rematch for the title, places, the stations, and what the engine
// refuses. Round robin is in bracket-round-robin.test.ts, undo in bracket-undo.test.ts, and
// late players in bracket-late.test.ts.

import { createSeededRandom, type Bracket, type BracketMatch } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import { bracketAnswer, createBracket, recordResult, type BracketState } from '../src/bracket-engine.ts';
import { at, expectOk, expectPodium, handles, ids, onStations, play, playOut, playOutInBatches, randomPick, start, type Pick } from './bracket-helpers.ts';

const sizes = (from: number): number[] => Array.from({ length: 33 - from }, (_, i) => i + from);
const doneMatches = (bracket: Bracket, side: BracketMatch['side']): BracketMatch[] => bracket.matches.filter((m) => m.side === side && m.status === 'done');
const winnerOf = (m: BracketMatch): number => m.slots[m.winner as 0 | 1].player?.id as number;
const loserOf = (m: BracketMatch): number => m.slots[1 - (m.winner as 0 | 1)]?.player?.id as number;
const placeOf = (bracket: Bracket, id: number): number | undefined => bracket.standings.find((r) => r.player.id === id)?.place;

describe('single elimination', () => {
  it('plays every size from 2 to 32 to a finish with n - 1 results, plus the 3rd-place match from 4', async () => {
    for (const n of sizes(2)) {
      const random = createSeededRandom(n);
      const run = await playOutInBatches(await start('single', n, n, 1 + (n % 8)), random, randomPick(random));
      expect(run.bracket.finished, `n=${n}`).toBe(true);
      expect(run.state.results, `n=${n}`).toHaveLength(n - 1 + (n >= 4 ? 1 : 0));
      expect(run.bracket.matches.every((m) => m.status === 'done' || m.status === 'bye')).toBe(true);
      expectPodium(run.bracket, n);
    }
  });

  it('plays the 3rd-place match between the semi-final losers from 4 players', async () => {
    for (const n of [4, 5, 8, 13, 32]) {
      const random = createSeededRandom(n + 50);
      const run = await playOutInBatches(await start('single', n, n, 4), random, randomPick(random));
      const [third] = doneMatches(run.bracket, 'third');
      if (!third) throw new Error(`n=${n}: no 3rd-place match played`);
      const rounds = Math.max(...run.bracket.matches.filter((m) => m.side === 'main').map((m) => m.round));
      const semiLosers = doneMatches(run.bracket, 'main').filter((m) => m.round === rounds - 1).map(loserOf);
      expect(third.slots.map((s) => s.player?.id).sort()).toEqual(semiLosers.sort());
      expect(placeOf(run.bracket, winnerOf(third))).toBe(3);
      expect(placeOf(run.bracket, loserOf(third))).toBe(4);
    }
  });

  it('gives 3 players a bye in the 3rd-place match, so the other semi-final loser is 3rd', async () => {
    const random = createSeededRandom(3);
    const run = await playOut(await start('single', 3, 3), random, randomPick(random));
    const third = run.bracket.matches.find((m) => m.side === 'third') as BracketMatch;
    expect(third.status).toBe('bye');
    const semi = doneMatches(run.bracket, 'main').find((m) => m.round === 1) as BracketMatch;
    expect(placeOf(run.bracket, loserOf(semi))).toBe(3);
  });

  it('gives 2 players only a final', async () => {
    const random = createSeededRandom(2);
    const run = await playOut(await start('single', 2, 2), random, randomPick(random));
    expect(run.bracket.matches.map((m) => [m.side, m.status])).toEqual([['main', 'done']]);
    expect(run.bracket.standings.map((r) => r.place)).toEqual([1, 2]);
  });

  it('shares the places below 4th by the round a player went out in', async () => {
    const random = createSeededRandom(16);
    const run = await playOutInBatches(await start('single', 16, 16, 4), random, randomPick(random));
    expect(run.bracket.standings.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 5, 5, 5, 9, 9, 9, 9, 9, 9, 9, 9]);
    // Wins count every match played: the champion won 4.
    expect(run.bracket.standings[0]).toMatchObject({ wins: 4, losses: 0 });
  });

  it('lists only the players whose place is settled while the bracket runs', async () => {
    let run = await start('single', 8, 8, 4);
    const random = createSeededRandom(8);
    for (const match of onStations(run.bracket)) run = await play(run, match, randomPick(random)(match));
    expect(run.bracket.finished).toBe(false);
    expect(run.bracket.standings.map((r) => r.place)).toEqual([5, 5, 5, 5]);
  });
});

describe('double elimination', () => {
  const finalWonBy =
    (side: 0 | 1, random: () => number): Pick =>
    (m) =>
      m.side === 'final' ? side : random() < 0.5 ? 0 : 1;

  it('plays every size from 3 to 32 with the rematch for the title: 2n - 1 results', async () => {
    for (const n of sizes(3)) {
      const random = createSeededRandom(n);
      const run = await playOutInBatches(await start('double', n, n, 1 + (n % 8)), random, finalWonBy(1, random));
      expect(run.bracket.finished, `n=${n}`).toBe(true);
      expect(run.state.results, `n=${n}`).toHaveLength(2 * n - 1);
      const [rematch] = doneMatches(run.bracket, 'rematch');
      if (!rematch) throw new Error(`n=${n}: no rematch`);
      expect(run.bracket.standings[0]?.player.id).toBe(winnerOf(rematch));
      expect(run.bracket.standings[1]?.player.id).toBe(loserOf(rematch));
      expectPodium(run.bracket, n);
    }
  });

  it('plays every size from 3 to 32 with no rematch when the unbeaten player wins the final: 2n - 2 results', async () => {
    for (const n of sizes(3)) {
      const random = createSeededRandom(n + 100);
      const run = await playOutInBatches(await start('double', n, n, 1 + ((n + 3) % 8)), random, finalWonBy(0, random));
      expect(run.bracket.finished, `n=${n}`).toBe(true);
      expect(run.state.results, `n=${n}`).toHaveLength(2 * n - 2);
      // A rematch that isn't needed is left out of the answer.
      expect(run.bracket.matches.some((m) => m.side === 'rematch')).toBe(false);
      const [final] = doneMatches(run.bracket, 'final');
      expect(run.bracket.standings[0]?.player.id).toBe(winnerOf(final as BracketMatch));
      expectPodium(run.bracket, n);
    }
  });

  it('places 3rd the player knocked out in the last round of the losers side, and shares places below that by round', async () => {
    const random = createSeededRandom(8);
    const run = await playOutInBatches(await start('double', 8, 8, 2), random, randomPick(random));
    const losers = doneMatches(run.bracket, 'losers');
    const lastRound = Math.max(...losers.map((m) => m.round));
    expect(placeOf(run.bracket, loserOf(losers.find((m) => m.round === lastRound) as BracketMatch))).toBe(3);
    expect(run.bracket.standings.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
  });

  it('shows the rematch as waiting until the first final is played', async () => {
    const random = createSeededRandom(4);
    const run = await start('double', 4, 4, 1);
    expect(run.bracket.matches.find((m) => m.side === 'rematch')?.status).toBe('waiting');
    const played = await playOut(run, random, randomPick(random));
    expect(played.bracket.finished).toBe(true);
  });
});

describe('stations and the queue', () => {
  it('never calls a player to two stations, and every called match is playing', async () => {
    for (const [format, n, stations] of [['single', 13, 3], ['double', 11, 4], ['round_robin', 9, 8]] as const) {
      const random = createSeededRandom(n);
      await playOut(await start(format, n, n, stations), random, randomPick(random), (_, after) => {
        const called = onStations(after.bracket);
        const players = called.flatMap((m) => m.slots.map((s) => s.player?.id));
        expect(new Set(players).size).toBe(players.length);
        expect(called.every((m) => m.status === 'playing')).toBe(true);
        expect(after.bracket.upNext.every((m) => m.status === 'ready')).toBe(true);
        expect(after.bracket.stations.every((s) => (s.match === null) === (s.calledAt === null))).toBe(true);
      });
    }
  });

  it('holds a match with a bye player until round 1 is finished, and calls it at the time of that result', async () => {
    // 5 players in 8 slots: one real first-round match and three byes.
    let run = await start('single', 5, 5, 2);
    const [first, second] = run.bracket.stations;
    expect(first?.match?.side).toBe('main');
    expect(first?.match?.round).toBe(1);
    expect(first?.calledAt).toBe(at(0));
    expect(second).toEqual({ number: 2, match: null, calledAt: null, arrived: false });
    const held = run.bracket.matches.find((m) => m.round === 2 && m.status === 'ready');
    expect(held).toBeDefined();
    expect(run.bracket.upNext).toEqual([]);

    run = await play(run, first?.match as BracketMatch, 0);
    expect(run.bracket.stations.map((s) => [s.match?.round, s.calledAt])).toEqual([
      [2, at(1)],
      [2, at(1)],
    ]);
  });

  it('fills stations in order at creation and refills the freed station with the first waiting match', async () => {
    let run = await start('single', 8, 1, 2);
    expect(run.bracket.stations.map((s) => s.match?.number)).toEqual([1, 2]);
    expect(run.bracket.upNext.map((m) => m.number)).toEqual([3, 4]);
    run = await play(run, run.bracket.stations[1]?.match as BracketMatch, 1);
    expect(run.bracket.stations.map((s) => s.match?.number)).toEqual([1, 3]);
    expect(run.bracket.stations[1]?.calledAt).toBe(at(1));
  });
});

describe('createBracket', () => {
  const make = (overrides: Partial<{ format: string; bestOf: number; stations: number; playerIds: number[] }>) =>
    createBracket(
      { id: 1, format: 'single', bestOf: 3, stations: 2, playerIds: ids(8), createdAt: at(0), ...overrides } as Parameters<typeof createBracket>[0],
      createSeededRandom(1),
      handles,
    );

  it('makes a bracket with every player once, the settings it was given, and nothing played', async () => {
    const run = expectOk(await make({}));
    expect(run.bracket).toMatchObject({ id: 1, format: 'single', bestOf: 3, finished: false, lateOpen: false, lastResultId: null, ties: [] });
    expect(run.state.seeding.slice().sort((a, b) => (a as number) - (b as number))).toEqual(ids(8));
    expect(run.bracket.stations).toHaveLength(2);
  });

  it('seeds the same way for the same random source', async () => {
    const a = expectOk(await make({ playerIds: ids(13) }));
    const b = expectOk(await make({ playerIds: ids(13) }));
    expect(a.state.seeding).toEqual(b.state.seeding);
    expect(a.state.seeding.slice(13)).toEqual([null, null, null]);
  });

  it('refuses two lives with 2 players, any format with 1, and more than 32', async () => {
    expect(await make({ format: 'double', playerIds: ids(2) })).toEqual({ ok: false, error: 'too-few-players' });
    expect(await make({ format: 'single', playerIds: ids(1) })).toEqual({ ok: false, error: 'too-few-players' });
    expect(await make({ format: 'round_robin', playerIds: [] })).toEqual({ ok: false, error: 'too-few-players' });
    expect(await make({ playerIds: ids(33) })).toEqual({ ok: false, error: 'too-many-players' });
    expect((await make({ format: 'double', playerIds: ids(3) })).ok).toBe(true);
    expect((await make({ format: 'round_robin', playerIds: ids(32) })).ok).toBe(true);
  });

  it('refuses bad settings, a player listed twice, and a player with no handle', async () => {
    for (const bad of [
      { stations: 0 },
      { stations: 9 },
      { stations: 1.5 },
      { bestOf: 2 },
      { format: 'swiss' },
      { playerIds: [1, 2, 2] },
      { playerIds: [1, 2, 99] },
    ]) {
      expect(await make(bad), JSON.stringify(bad)).toEqual({ ok: false, error: 'bad-request' });
    }
    expect((await make({ stations: 8 })).ok).toBe(true);
  });
});

describe('recordResult', () => {
  it('refuses a missing match, one not on a station, and a winner from outside the match', async () => {
    const run = await start('single', 8, 1, 1);
    const onStation = run.bracket.stations[0]?.match as BracketMatch;
    const queued = run.bracket.upNext[0] as BracketMatch;
    const waiting = run.bracket.matches.find((m) => m.status === 'waiting') as BracketMatch;
    const record = (matchId: number, winnerId: number) => recordResult(run.state, { id: 1, matchId, winnerId, at: at(1) }, handles);
    expect(await record(999, 1)).toEqual({ ok: false, error: 'not-found' });
    expect(await record(queued.id, queued.slots[0].player?.id as number)).toEqual({ ok: false, error: 'not-on-station' });
    expect(await record(waiting.id, 1)).toEqual({ ok: false, error: 'not-on-station' });
    expect(await record(onStation.id, queued.slots[0].player?.id as number)).toEqual({ ok: false, error: 'bad-request' });
  });

  it('records the winner and loser with the time, and answers with the result id to undo', async () => {
    const run = await start('single', 4, 1, 1);
    const match = run.bracket.stations[0]?.match as BracketMatch;
    const [a, b] = match.slots.map((s) => s.player?.id as number);
    const after = expectOk(await recordResult(run.state, { id: 7, matchId: match.id, winnerId: b as number, at: at(1) }, handles));
    expect(after.state.results).toEqual([{ id: 7, matchId: match.id, winnerId: b, loserId: a, at: at(1) }]);
    expect(after.bracket.lastResultId).toBe(7);
    expect(after.bracket.matches.find((m) => m.id === match.id)).toMatchObject({ status: 'done', winner: 1, resultId: 7 });
    // The state passed in is left as it was.
    expect(run.state.results).toEqual([]);
  });

  it('refuses the rematch for the title once the unbeaten player has won the final', async () => {
    const random = createSeededRandom(5);
    const run = await playOut(await start('double', 3, 5, 1), random, (m) => (m.side === 'final' ? 0 : 1));
    const rematchId = Math.max(...run.bracket.matches.map((m) => m.id)) + 1;
    expect(await recordResult(run.state, { id: 99, matchId: rematchId, winnerId: 1, at: at(99) }, handles)).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('the answer', () => {
  it('names every field and carries a player only as an id and a handle (CLAUDE.md, rule 1)', async () => {
    const random = createSeededRandom(6);
    const run = await playOut(await start('double', 6, 6, 2), random, randomPick(random));
    expect(Object.keys(run.bracket).sort()).toEqual(
      ['finished', 'format', 'bestOf', 'id', 'lateOpen', 'lastResultId', 'noShowMinutes', 'matches', 'standings', 'stations', 'ties', 'upNext'].sort(),
    );
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value === null || typeof value !== 'object') return;
      if ('handle' in value) expect(Object.keys(value).sort()).toEqual(['handle', 'id']);
      Object.values(value).forEach(walk);
    };
    walk(run.bracket);
    for (const m of run.bracket.matches) expect(Object.keys(m).sort()).toEqual(['forfeit', 'id', 'number', 'resultId', 'round', 'side', 'slots', 'status', 'winner']);
  });

  it('is the same every time for the same state', async () => {
    const random = createSeededRandom(9);
    const run = await playOut(await start('single', 9, 9, 3), random, randomPick(random));
    expect(await bracketAnswer(run.state, handles)).toEqual(run.bracket);
  });

  it('throws on a stored log that no longer replays', async () => {
    const run = await start('single', 4, 1, 1);
    const broken: BracketState = { ...run.state, results: [{ id: 1, matchId: 0, winnerId: 40, loserId: 39, at: at(1) }] };
    await expect(bracketAnswer(broken, handles)).rejects.toThrow('does not replay');
  });

  it('rebuilds 32 players from the full log quickly: two lives in well under a second', async () => {
    const random = createSeededRandom(32);
    const run = await playOutInBatches(await start('double', 32, 32, 8), random, randomPick(random));
    const started = performance.now();
    await bracketAnswer(run.state, handles);
    // About 6 ms on the dev box (2026-11-13); the bound leaves room for a slow CI runner.
    expect(performance.now() - started).toBeLessThan(500);
  });
});
