// "They're here" on a bracket (docs/PLAN.md, "Waiting for a missing player"): the host says the
// players of a match on a station have come, and the answer shows it for that call of the match
// only. It is stored apart from the results, so rule 5 (every result can be undone exactly) is
// untouched. The engine first, then the route.

import type { Bracket, BracketMatch } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { setArrived, startTieBreak } from '../src/bracket-engine.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, makeCallers, onStations as apiOnStations, type Api, type Callers } from './bracket-api-helpers.ts';
import { addPinPlayers, eventually, listen, signInPhone } from './phone-helpers.ts';
import { expectOk, handles, onStations, play, start, undo, type Run } from './bracket-helpers.ts';

const arrivedFlags = (bracket: Bracket): boolean[] => bracket.stations.map((s) => s.arrived);
const arrive = async (run: Run, matchId: number, arrived = true): Promise<Run> => expectOk(await setArrived(run.state, { matchId, arrived }, handles));

describe('setArrived', () => {
  it('marks the match on a station for its current call, and takes it back', async () => {
    const run = await start('single', 4, 1, 2);
    const [a] = onStations(run.bracket) as [BracketMatch, BracketMatch];
    expect(arrivedFlags(run.bracket)).toEqual([false, false]);

    const here = await arrive(run, a.id);
    expect(arrivedFlags(here.bracket)).toEqual([true, false]);
    expect(here.state.arrivals).toEqual([{ matchId: a.id, calledAt: run.bracket.stations[0]?.calledAt }]);

    const gone = await arrive(here, a.id, false);
    expect(arrivedFlags(gone.bracket)).toEqual([false, false]);
    expect(gone.state).toEqual(run.state);
  });

  it('says the same thing twice with the same result', async () => {
    const run = await start('single', 4, 1, 2);
    const [a] = onStations(run.bracket) as [BracketMatch];
    const once = await arrive(run, a.id);
    expect((await arrive(once, a.id)).state).toEqual(once.state);
    expect((await arrive(run, a.id, false)).state).toEqual(run.state);
  });

  it('refuses a match that is not on a station and one that does not exist', async () => {
    const run = await start('single', 4, 1, 2);
    const waiting = run.bracket.matches.find((m) => m.status === 'waiting') as BracketMatch;
    expect(await setArrived(run.state, { matchId: waiting.id, arrived: true }, handles)).toEqual({ ok: false, error: 'not-on-station' });
    expect(await setArrived(run.state, { matchId: 999, arrived: true }, handles)).toEqual({ ok: false, error: 'not-found' });
    const [a] = onStations(run.bracket) as [BracketMatch];
    const played = await play(run, a, 0);
    expect(await setArrived(played.state, { matchId: a.id, arrived: true }, handles)).toEqual({ ok: false, error: 'not-on-station' });
  });

  it('changes no result: the log, the standings, and the next call are the same with or without it', async () => {
    const run = await start('single', 4, 1, 2);
    const [a] = onStations(run.bracket) as [BracketMatch];
    const plain = await play(run, a, 0);
    const marked = await play(await arrive(run, a.id), a, 0);
    expect(marked.state.results).toEqual(plain.state.results);
    expect(marked.bracket).toEqual(plain.bracket);
  });

  it('is still there after the newest result is undone, which restores the bracket exactly', async () => {
    const run = await start('single', 4, 1, 2);
    const [a] = onStations(run.bracket) as [BracketMatch];
    const here = await arrive(run, a.id);
    const played = await play(here, a, 0);
    expect(arrivedFlags(played.bracket)).not.toContain(true);
    const undone = expectOk(await undo(played.state, played.state.results[0]?.id as number));
    expect(undone.state).toEqual(here.state);
    expect(undone.bracket).toEqual(here.bracket);
    expect(arrivedFlags(undone.bracket)).toEqual([true, false]);
  });

  it('starts a new wait when a match is reopened by an older undo and called again', async () => {
    // One station and a round robin, so the second match is on the station when the first is undone.
    let run = await start('round_robin', 4, 2, 1);
    const first = onStations(run.bracket)[0] as BracketMatch;
    run = await arrive(run, first.id);
    const firstCall = run.bracket.stations[0]?.calledAt;
    run = await play(run, first, 0);
    const firstResult = run.state.results[0]?.id as number;
    // A second result makes the first one an older result. Undoing it reopens the first match,
    // which waits in Up next while the third plays.
    run = await play(run, onStations(run.bracket)[0] as BracketMatch, 1);
    run = expectOk(await undo(run.state, firstResult));
    expect(onStations(run.bracket)[0]?.id).not.toBe(first.id);
    run = await play(run, onStations(run.bracket)[0] as BracketMatch, 1);

    const again = run.bracket.stations[0];
    expect(again?.match?.id).toBe(first.id);
    expect(again?.calledAt).not.toBe(firstCall);
    expect(again?.arrived).toBe(false);
    // The first call's arrival is still stored, and answers nothing for the new call.
    expect(run.state.arrivals).toEqual([{ matchId: first.id, calledAt: firstCall }]);

    const here = await arrive(run, first.id);
    expect(here.bracket.stations[0]?.arrived).toBe(true);
    expect(here.state.arrivals).toHaveLength(2);
  });

  it('drops the arrival of a tie-break that an undo takes away, so a new one with that id starts fresh', async () => {
    let run = await start('round_robin', 3, 1, 1);
    const beats = new Map<number, number>();
    const ids = [1, 2, 3];
    ids.forEach((id, i) => beats.set(id, ids[(i + 1) % 3] as number));
    let beforeLast = run;
    while (onStations(run.bracket).length > 0) {
      const m = onStations(run.bracket)[0] as BracketMatch;
      const [p, q] = [m.slots[0].player?.id as number, m.slots[1].player?.id as number];
      beforeLast = run;
      run = await play(run, m, beats.get(p) === q ? 0 : 1);
    }
    expect(run.bracket.ties).toHaveLength(1);
    const lastResult = run.state.results.at(-1)?.id as number;
    run = expectOk(await startTieBreak(run.state, handles, 5));
    const tie = onStations(run.bracket)[0] as BracketMatch;
    run = await arrive(run, tie.id);
    expect(run.state.arrivals).toHaveLength(1);
    // The newest result's undo takes the tie-break away, and the arrival with it.
    run = expectOk(await undo(run.state, lastResult));
    expect(run.state.arrivals).toEqual([]);
    expect(run.state).toEqual(beforeLast.state);
    expect(run.bracket).toEqual(beforeLast.bracket);
  });
});

describe('POST /api/bracket/arrived', () => {
  let app: FastifyInstance;
  let db: Database;
  let callers: Callers;
  let host: Api;
  let ids: number[];

  beforeEach(async () => {
    db = openDatabase(':memory:');
    app = await buildApp({ db });
    await app.ready();
    callers = await makeCallers(app);
    host = callers.host;
    ids = addPlayers(db, 4);
  });
  afterEach(() => app.close());

  const make = async (): Promise<Bracket> => {
    const res = await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 2, playerIds: ids });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().bracket;
  };

  it('marks the match and answers the bracket with the server time', async () => {
    const bracket = await make();
    const match = apiOnStations(bracket)[0] as BracketMatch;
    const res = await host('POST', '/api/bracket/arrived', { matchId: match.id, arrived: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['bracket', 'now']);
    expect(res.json().bracket.stations.map((s: { arrived: boolean }) => s.arrived)).toEqual([true, false]);
    expect(Number.isNaN(Date.parse(res.json().now))).toBe(false);
    // It is stored, so a read and a restart see it.
    expect(((await host('GET', '/api/bracket')).json().bracket as Bracket).stations[0]?.arrived).toBe(true);
    expect(db.prepare('SELECT match_id, called_at FROM bracket_arrivals').all()).toEqual([
      { match_id: match.id, called_at: bracket.stations[0]?.calledAt },
    ]);

    const undone = await host('POST', '/api/bracket/arrived', { matchId: match.id, arrived: false });
    expect(undone.json().bracket.stations[0].arrived).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_arrivals').get()).toEqual({ n: 0 });
  });

  it('is refused for a Display, a Sign-up device, a phone, and a stranger, and changes nothing', async () => {
    const bracket = await make();
    const match = apiOnStations(bracket)[0] as BracketMatch;
    addPinPlayers(db, 1, 20);
    const phone = await signInPhone(app, 'Player20');
    for (const who of [callers.display, callers.signup, callers.nobody, phone.api]) {
      const res = await who('POST', '/api/bracket/arrived', { matchId: match.id, arrived: true });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_arrivals').get()).toEqual({ n: 0 });
  });

  it('answers 404 with no bracket, 404 for an unknown match, 409 off a station, and 400 for a body it does not know', async () => {
    expect((await host('POST', '/api/bracket/arrived', { matchId: 0, arrived: true })).json()).toEqual({ error: 'no-bracket' });
    const bracket = await make();
    const waiting = bracket.matches.find((m) => m.status === 'waiting') as BracketMatch;
    expect((await host('POST', '/api/bracket/arrived', { matchId: 999, arrived: true })).json()).toEqual({ error: 'not-found' });
    const off = await host('POST', '/api/bracket/arrived', { matchId: waiting.id, arrived: true });
    expect([off.statusCode, off.json()]).toEqual([409, { error: 'not-on-station' }]);
    for (const body of [{ matchId: 0 }, { arrived: true }, { matchId: 0, arrived: 'yes' }, { matchId: -1, arrived: true }]) {
      expect((await host('POST', '/api/bracket/arrived', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('tells every screen with a bracket message', async () => {
    const bracket = await make();
    const live = await listen(app, undefined, '127.0.0.1');
    const match = apiOnStations(bracket)[0] as BracketMatch;
    await host('POST', '/api/bracket/arrived', { matchId: match.id, arrived: true });
    await host('POST', '/api/bracket/arrived', { matchId: 999, arrived: true });
    await host('PUT', '/api/event', { name: 'Marker' });
    await eventually(() => expect(live.messages.some((m) => m.type === 'event')).toBe(true));
    expect(live.messages.filter((m) => m.type === 'bracket')).toEqual([{ type: 'bracket' }]);
    live.terminate();
  });
});
