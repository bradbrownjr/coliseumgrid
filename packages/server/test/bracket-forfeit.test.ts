// A forfeit (docs/PLAN.md, "Waiting for a missing player"): the winner is the player who came.
// It is logged, replayed, and undone like any result, and the answer marks the match.

import { createSeededRandom, type BracketFormat, type BracketMatch } from '@coliseumgrid/core';
import type { Bracket } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { addPlayers, expectContractShape, makeCallers, onStations as apiOnStations, type Api } from './bracket-api-helpers.ts';
import { bracketAnswer, recordResult, type BracketState } from '../src/bracket-engine.ts';
import { createBracketStore, type BracketStore } from '../src/bracket-store.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { expectOk, expectPodium, handles, onStations, play, start, undo, type Run } from './bracket-helpers.ts';

/** Undoes the newest result and checks the answer and the state are exactly the earlier ones. */
async function expectUndoRestores(before: Run, after: Run): Promise<void> {
  const undone = expectOk(await undo(after.state, after.state.results.at(-1)?.id as number));
  expect(undone.bracket).toEqual(before.bracket);
  expect(undone.state).toEqual(before.state);
}

const matchOf = (run: Run, id: number): BracketMatch => run.bracket.matches.find((m) => m.id === id) as BracketMatch;

describe('a forfeit result', () => {
  it('marks the match, names the player who came as the winner, and moves them on', async () => {
    const run = await start('single', 4, 1, 2);
    const [a, b] = onStations(run.bracket) as [BracketMatch, BracketMatch];
    const afterA = await play(run, a, 1, true);
    expect(matchOf(afterA, a.id)).toMatchObject({ status: 'done', winner: 1, forfeit: true });
    expect(afterA.state.results[0]).toMatchObject({ matchId: a.id, winnerId: a.slots[1].player?.id, loserId: a.slots[0].player?.id, forfeit: true });
    // The other match is untouched, and the winner waits in the final for the other semi-final.
    expect(matchOf(afterA, b.id).forfeit).toBe(false);
    expect(afterA.bracket.matches.filter((m) => m.forfeit)).toHaveLength(1);

    const afterB = await play(afterA, b, 0);
    const final = onStations(afterB.bracket).find((m) => m.side === 'main') as BracketMatch;
    expect(final.slots.map((s) => s.player?.id)).toContain(a.slots[1].player?.id);
    expect(final.forfeit).toBe(false);
  });

  it('is left off every result that was not a forfeit, in the state and in the answer', async () => {
    const run = await start('single', 4, 1, 2);
    const played = await play(run, onStations(run.bracket)[0] as BracketMatch, 0);
    expect('forfeit' in (played.state.results[0] as object)).toBe(false);
    expect(played.bracket.matches.every((m) => m.forfeit === false)).toBe(true);
    // `forfeit: false` sent by a route is the same as leaving it out.
    const match = onStations(run.bracket)[0] as BracketMatch;
    const explicit = expectOk(
      await recordResult(
        run.state,
        { id: 1, matchId: match.id, winnerId: match.slots[0].player?.id as number, at: played.state.results[0]?.at as string, forfeit: false },
        handles,
      ),
    );
    expect(explicit.state).toEqual(played.state);
  });

  it('counts as a win and a loss, like any result', async () => {
    const run = await start('round_robin', 4, 2, 2);
    const match = onStations(run.bracket)[0] as BracketMatch;
    const played = await play(run, match, 0, true);
    const wins = (r: Run, id: number): number => r.bracket.standings.find((row) => row.player.id === id)?.wins as number;
    expect(wins(played, match.slots[0].player?.id as number)).toBe(1);
    expect(played.bracket.standings.find((row) => row.player.id === match.slots[1].player?.id)).toMatchObject({ wins: 0, losses: 1 });
  });

  it('plays an elimination bracket to a finish with every result a forfeit', async () => {
    for (const [format, n] of [['single', 6], ['double', 5]] as const) {
      let run = await start(format, n, 5, 2);
      while (onStations(run.bracket).length > 0) run = await play(run, onStations(run.bracket)[0] as BracketMatch, 0, true);
      expect(run.bracket.finished, format).toBe(true);
      expectPodium(run.bracket, n);
      expect(run.bracket.matches.filter((m) => m.status === 'done').every((m) => m.forfeit)).toBe(true);
    }
  });
});

describe('undo of a forfeit', () => {
  const cases: Array<[BracketFormat, number[]]> = [
    ['single', [3, 4, 8]],
    ['double', [3, 5, 8]],
    ['round_robin', [3, 4, 6]],
  ];
  for (const [format, sizes] of cases) {
    it(`restores the answer and the state exactly after every forfeit: ${format}, ${sizes.join(', ')} players`, async () => {
      let checks = 0;
      for (const n of sizes) {
        const random = createSeededRandom(n);
        let run = await start(format, n, n, 1 + (n % 3));
        while (onStations(run.bracket).length > 0) {
          const live = onStations(run.bracket);
          const match = live[Math.floor(random() * live.length)] as BracketMatch;
          // Half the results are forfeits, so both kinds sit in the log together.
          const next = await play(run, match, random() < 0.5 ? 0 : 1, random() < 0.5);
          await expectUndoRestores(run, next);
          checks++;
          run = next;
        }
      }
      expect(checks).toBeGreaterThan(sizes.length);
    });
  }

  it('restores the answer exactly when the newest result is a forfeit and an older result came before it', async () => {
    const run = await start('single', 8, 1, 3);
    const first = await play(run, onStations(run.bracket)[0] as BracketMatch, 0);
    const second = await play(first, onStations(first.bracket)[1] as BracketMatch, 1, true);
    await expectUndoRestores(first, second);
    expect(second.state.results.map((r) => r.forfeit === true)).toEqual([false, true]);
  });

  it('takes an older forfeit back: the match opens again, and the answer matches one where it never happened', async () => {
    // 4 players everyone plays everyone, 2 stations: A is a forfeit, B is played, then A is undone.
    const run = await start('round_robin', 4, 2, 2);
    const [a, b] = onStations(run.bracket) as [BracketMatch, BracketMatch];
    const afterA = await play(run, a, 0, true);
    const afterB = await play(afterA, b, 1);
    const undone = expectOk(await undo(afterB.state, afterA.state.results[0]?.id as number));

    expect(matchOf(undone, a.id)).toMatchObject({ winner: null, forfeit: false, resultId: null });
    expect(matchOf(undone, a.id).status).not.toBe('done');
    // The result stays in the log with its mark, undone.
    expect(undone.state.results[0]).toMatchObject({ forfeit: true, undone: { step: 2 } });
    // Everything else is what it is when only B was played.
    const onlyB = await play(run, b, 1);
    const view = (r: Run) => ({
      standings: r.bracket.standings,
      done: r.bracket.matches.filter((m) => m.status === 'done').map((m) => [m.id, m.winner, m.forfeit]),
    });
    expect(view(undone)).toEqual(view(onlyB));
  });
});

describe('the bracket store with forfeits', () => {
  let db: Database;
  let store: BracketStore;
  let eventId: number;
  beforeEach(() => {
    db = openDatabase(':memory:');
    store = createBracketStore(db);
    eventId = Number(db.prepare("INSERT INTO events (name, created_at) VALUES ('Friday', 't')").run().lastInsertRowid);
  });

  it('loads exactly the state it saved, forfeits and an undone forfeit included, and the answer is the same', async () => {
    const run = await start('round_robin', 4, 2, 2);
    const [a, b] = onStations(run.bracket) as [BracketMatch, BracketMatch];
    const afterA = await play(run, a, 0, true);
    const afterB = await play(afterA, b, 1);
    const undone = expectOk(await undo(afterB.state, afterA.state.results[0]?.id as number));
    for (const state of [afterA.state, afterB.state, undone.state]) {
      store.save(eventId, state);
      const loaded = store.load(eventId);
      expect(loaded).toEqual(state);
      expect(await bracketAnswer(loaded as BracketState, handles)).toEqual(await bracketAnswer(state, handles));
    }
    expect(db.prepare('SELECT forfeit FROM bracket_results ORDER BY id').all()).toEqual([{ forfeit: 1 }, { forfeit: 0 }]);
  });
});

describe('POST /api/bracket/results with forfeit', () => {
  let app: FastifyInstance;
  let host: Api;
  let ids: number[];
  beforeEach(async () => {
    const db = openDatabase(':memory:');
    app = await buildApp({ db });
    ({ host } = await makeCallers(app));
    ids = addPlayers(db, 4);
  });
  afterEach(() => app.close());

  it('marks the match, answers with the field, and the undo takes it back', async () => {
    const made = (await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 2, playerIds: ids })).json().bracket as Bracket;
    const match = apiOnStations(made)[0] as BracketMatch;
    const res = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[1].player?.id, forfeit: true });
    expect(res.statusCode, res.body).toBe(200);
    expectContractShape(res.json().bracket);
    expect((res.json().bracket as Bracket).matches.find((m) => m.id === match.id)).toMatchObject({ status: 'done', winner: 1, forfeit: true });

    const undone = await host('POST', '/api/bracket/undo', { resultId: res.json().resultId });
    expect(undone.statusCode).toBe(200);
    expect((undone.json().bracket as Bracket).matches.find((m) => m.id === match.id)).toMatchObject({ winner: null, forfeit: false });
  });

  it('treats `forfeit: false` as leaving it out, and refuses a forfeit that is not a boolean or a winner who is not in the match', async () => {
    const made = (await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 2, playerIds: ids })).json().bracket as Bracket;
    const [a, b] = apiOnStations(made) as [BracketMatch, BracketMatch];
    expect((await host('POST', '/api/bracket/results', { matchId: a.id, winnerId: a.slots[0].player?.id, forfeit: 'yes' })).statusCode).toBe(400);
    expect((await host('POST', '/api/bracket/results', { matchId: a.id, winnerId: b.slots[0].player?.id, forfeit: true })).statusCode).toBe(400);
    const ok = await host('POST', '/api/bracket/results', { matchId: a.id, winnerId: a.slots[0].player?.id, forfeit: false });
    expect((ok.json().bracket as Bracket).matches.find((m) => m.id === a.id)?.forfeit).toBe(false);
  });
});
