// "They're here" on groups (docs/PLAN.md, "Waiting for a missing player"): as in
// bracket-arrived.test.ts, it names a station's current call of the group, is stored apart from
// the results, and ends with the call. The engine first, then the route.

import type { Heat, Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { setHeatArrived } from '../src/heat-engine.ts';
import { addPlayers, makeCallers, type Api, type Callers } from './bracket-api-helpers.ts';
import { heatsBody, heatsOnStations as apiOnStations } from './heat-api-helpers.ts';
import { expectOk, handles, listedPick, onStations, play, start, undo, type HeatRun } from './heat-helpers.ts';
import { addPinPlayers, eventually, listen, signInPhone } from './phone-helpers.ts';

const arrivedFlags = (heats: Heats): boolean[] => heats.stations.map((s) => s.arrived);
const arrive = (run: HeatRun, heatId: number, arrived = true): HeatRun => expectOk(setHeatArrived(run.state, { heatId, arrived }, handles));
const order = (heat: Heat): number[] => listedPick(heat);

describe('setHeatArrived', () => {
  it('marks the group on a station for its current call, and takes it back', () => {
    const run = start(12, 1, { stations: 2, rounds: 1 });
    const [a] = onStations(run.heats) as [Heat, Heat];
    expect(arrivedFlags(run.heats)).toEqual([false, false]);

    const here = arrive(run, a.id);
    expect(arrivedFlags(here.heats)).toEqual([true, false]);
    expect(here.state.arrivals).toEqual([{ heatId: a.id, calledAt: run.heats.stations[0]?.calledAt }]);

    const gone = arrive(here, a.id, false);
    expect(arrivedFlags(gone.heats)).toEqual([false, false]);
    expect(gone.state).toEqual(run.state);
  });

  it('says the same thing twice with the same result', () => {
    const run = start(12, 1, { stations: 2, rounds: 1 });
    const [a] = onStations(run.heats) as [Heat];
    const once = arrive(run, a.id);
    expect(arrive(once, a.id).state).toEqual(once.state);
    expect(arrive(run, a.id, false).state).toEqual(run.state);
  });

  it('refuses a group that is not on a station and one that does not exist', () => {
    const run = start(12, 1, { stations: 2, rounds: 1 });
    const waiting = run.heats.upNext[0] as Heat;
    expect(setHeatArrived(run.state, { heatId: waiting.id, arrived: true }, handles)).toEqual({ ok: false, error: 'not-on-station' });
    expect(setHeatArrived(run.state, { heatId: 999, arrived: true }, handles)).toEqual({ ok: false, error: 'not-found' });
  });

  it('changes no result: the log, the standings, and the next call are the same with or without it', () => {
    const run = start(12, 1, { stations: 2, rounds: 1 });
    const [a] = onStations(run.heats) as [Heat];
    const plain = play(run, a, order(a));
    const marked = play(arrive(run, a.id), a, order(a));
    expect(marked.state.results).toEqual(plain.state.results);
    expect(marked.heats).toEqual(plain.heats);
  });

  it('is still there after the newest result is undone, which restores the groups exactly', () => {
    const run = start(12, 1, { stations: 2, rounds: 1 });
    const [a] = onStations(run.heats) as [Heat];
    const here = arrive(run, a.id);
    const played = play(here, a, order(a));
    const undone = expectOk(undo(played.state, played.state.results[0]?.id as number));
    expect(undone.state).toEqual(here.state);
    expect(undone.heats).toEqual(here.heats);
    expect(arrivedFlags(undone.heats)).toEqual([true, false]);
  });

  it('starts a new wait when a group is reopened by an older undo and called again', () => {
    // Three groups of four on one station: with groups 1 and 2 played, 3 is on the station when 1 is undone.
    let run = start(12, 1, { stations: 1, rounds: 1 });
    const first = onStations(run.heats)[0] as Heat;
    run = arrive(run, first.id);
    const firstCall = run.heats.stations[0]?.calledAt;
    run = play(run, first, order(first));
    const firstResult = run.state.results[0]?.id as number;
    run = play(run, onStations(run.heats)[0] as Heat, order(onStations(run.heats)[0] as Heat));
    run = expectOk(undo(run.state, firstResult));
    expect(onStations(run.heats)[0]?.id).not.toBe(first.id);
    run = play(run, onStations(run.heats)[0] as Heat, order(onStations(run.heats)[0] as Heat));

    const again = run.heats.stations[0];
    expect(again?.heat?.id).toBe(first.id);
    expect(again?.calledAt).not.toBe(firstCall);
    expect(again?.arrived).toBe(false);
    expect(run.state.arrivals).toEqual([{ heatId: first.id, calledAt: firstCall }]);

    const here = arrive(run, first.id);
    expect(here.heats.stations[0]?.arrived).toBe(true);
    expect(here.state.arrivals).toHaveLength(2);
  });

  it('drops the arrival of a group that an undo takes away, so a new group with that id starts fresh', () => {
    // Round 1 done makes round 2; undoing the newest result takes round 2 away with its arrival.
    let run = start(8, 1, { stations: 2, rounds: 2 });
    let beforeLast = run;
    while (run.heats.round === 1 && onStations(run.heats).length > 0) {
      beforeLast = run;
      const heat = onStations(run.heats)[0] as Heat;
      run = play(run, heat, order(heat));
    }
    expect(run.heats.round).toBe(2);
    const lastResult = run.state.results.at(-1)?.id as number;
    const roundTwo = onStations(run.heats)[0] as Heat;
    run = arrive(run, roundTwo.id);
    expect(run.state.arrivals).toHaveLength(1);
    run = expectOk(undo(run.state, lastResult));
    expect(run.state.arrivals).toEqual([]);
    expect(run.state).toEqual(beforeLast.state);
    expect(run.heats).toEqual(beforeLast.heats);
  });
});

describe('POST /api/heats/arrived', () => {
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
    ids = addPlayers(db, 12);
  });
  afterEach(() => app.close());

  const make = async (): Promise<Heats> => {
    const res = await host('POST', '/api/heats', heatsBody(ids, { stations: 2, rounds: 1 }));
    expect(res.statusCode, res.body).toBe(201);
    return res.json().heats;
  };

  it('marks the group and answers the heats with the server time', async () => {
    const heats = await make();
    const heat = apiOnStations(heats)[0] as Heat;
    const res = await host('POST', '/api/heats/arrived', { heatId: heat.id, arrived: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['heats', 'now']);
    expect(res.json().heats.stations.map((s: { arrived: boolean }) => s.arrived)).toEqual([true, false]);
    expect(Number.isNaN(Date.parse(res.json().now))).toBe(false);
    expect(((await host('GET', '/api/heats')).json().heats as Heats).stations[0]?.arrived).toBe(true);
    expect(db.prepare('SELECT heat_id, called_at FROM heat_arrivals').all()).toEqual([{ heat_id: heat.id, called_at: heats.stations[0]?.calledAt }]);

    const undone = await host('POST', '/api/heats/arrived', { heatId: heat.id, arrived: false });
    expect(undone.json().heats.stations[0].arrived).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM heat_arrivals').get()).toEqual({ n: 0 });
  });

  it('is refused for a Display, a Sign-up device, a phone, and a stranger, and changes nothing', async () => {
    const heats = await make();
    const heat = apiOnStations(heats)[0] as Heat;
    addPinPlayers(db, 1, 20);
    const phone = await signInPhone(app, 'Player20');
    for (const who of [callers.display, callers.signup, callers.nobody, phone.api]) {
      const res = await who('POST', '/api/heats/arrived', { heatId: heat.id, arrived: true });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM heat_arrivals').get()).toEqual({ n: 0 });
  });

  it('answers 404 with no heats, 404 for an unknown group, 409 off a station, and 400 for a body it does not know', async () => {
    expect((await host('POST', '/api/heats/arrived', { heatId: 0, arrived: true })).json()).toEqual({ error: 'no-heats' });
    const heats = await make();
    const waiting = heats.upNext[0] as Heat;
    expect((await host('POST', '/api/heats/arrived', { heatId: 999, arrived: true })).json()).toEqual({ error: 'not-found' });
    const off = await host('POST', '/api/heats/arrived', { heatId: waiting.id, arrived: true });
    expect([off.statusCode, off.json()]).toEqual([409, { error: 'not-on-station' }]);
    for (const body of [{ heatId: 0 }, { arrived: true }, { heatId: 0, arrived: 'yes' }, { heatId: -1, arrived: true }]) {
      expect((await host('POST', '/api/heats/arrived', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('tells every screen with a heats message', async () => {
    const heats = await make();
    const live = await listen(app, undefined, '127.0.0.1');
    const heat = apiOnStations(heats)[0] as Heat;
    await host('POST', '/api/heats/arrived', { heatId: heat.id, arrived: true });
    await host('POST', '/api/heats/arrived', { heatId: 999, arrived: true });
    await host('PUT', '/api/event', { name: 'Marker' });
    await eventually(() => expect(live.messages.some((m) => m.type === 'event')).toBe(true));
    expect(live.messages.filter((m) => m.type === 'heats')).toEqual([{ type: 'heats' }]);
    live.terminate();
  });
});
