// The event's game and plan, and new events (docs/PLAN.md, "Devices and host API" and "The
// setup wizard"): who may call each route, every answer's fields, every refusal, and what is
// stored. The plan's rules are tested in core (event-plan.test.ts); here is the edge.

import { NO_SHOW_DEFAULT, planDefaults, type Bracket, type EventPlan, type Heats } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventInfoSchema, nullableEventSchema, planSchema } from '../src/api-schemas.ts';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { cleanGameName, createEvents } from '../src/events.ts';
import { makeCallers, onStations, type Api, type Callers } from './bracket-api-helpers.ts';
import { heatsBody } from './heat-api-helpers.ts';
import { PHONE_IP, addPinPlayers, eventually, listen, signInPhone, type Phone } from './phone-helpers.ts';

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
  ids = addPinPlayers(db, 8);
});
afterEach(() => app.close());

const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const eventOf = async (): Promise<unknown> => (await host('GET', '/api/event')).json().event;
const planOf = async (): Promise<unknown> => (await host('GET', '/api/event/plan')).json().plan;
const bracketBody = (n = 4) => ({ format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, n) });

describe('cleanGameName', () => {
  it('tidies spaces like the event name, and takes an empty name as none', () => {
    expect(cleanGameName('  Race \t Night  ')).toBe('Race Night');
    expect(cleanGameName('')).toBe('');
    expect(cleanGameName('   ')).toBe('');
    expect(cleanGameName('x'.repeat(60))).toBe('x'.repeat(60));
  });

  it('refuses a name over 60 characters and one with a control character', () => {
    expect(cleanGameName('x'.repeat(61))).toBeNull();
    expect(cleanGameName('Race\u0000Night')).toBeNull();
    expect(cleanGameName('Race‮Night')).toBeNull();
  });
});

describe('who may call each route', () => {
  const hostOnly: Array<[string, string, object?]> = [
    ['GET', '/api/event/plan'],
    ['PUT', '/api/event/plan', { plan: planDefaults('fighting') }],
    ['POST', '/api/events', { name: 'Saturday' }],
  ];
  let phone: Phone;
  beforeEach(async () => {
    phone = await signInPhone(app, 'Player1');
  });

  it.each(hostOnly)('%s %s answers 401 not-signed-in to a phone, a Display, a Sign-up device, and a stranger', async (method, url, payload) => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const before = [count('events'), await planOf()];
    for (const who of [phone.api, callers.display, callers.signup, callers.nobody]) {
      const res = await who(method as 'GET', url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
    // Nothing was written.
    expect([count('events'), await planOf()]).toEqual(before);
  });

  it('answers the host, from the laptop', async () => {
    expect((await host('GET', '/api/event/plan')).statusCode).toBe(200);
  });

  it('lets a phone, a Display, and a Sign-up device read the event and its game, and a stranger not', async () => {
    await host('PUT', '/api/event', { name: 'Friday', game: 'Race Night' });
    for (const who of [phone.api, callers.display, callers.signup, host]) {
      expect((await who('GET', '/api/event')).json()).toEqual({ event: { name: 'Friday', game: 'Race Night' } });
    }
    expect((await callers.nobody('GET', '/api/event')).statusCode).toBe(401);
  });
});

describe('PUT /api/event with a game', () => {
  it('stores it, answers it, and tells the screens with the event message', async () => {
    const live = await listen(app, undefined, '127.0.0.1');
    const res = await host('PUT', '/api/event', { name: 'Friday', game: 'Race  Night ' });
    expect(res.json()).toEqual({ event: { name: 'Friday', game: 'Race Night' } });
    expect(db.prepare('SELECT name, game FROM events').all()).toEqual([{ name: 'Friday', game: 'Race Night' }]);
    await eventually(() => expect(live.messages).toContainEqual({ type: 'event', event: { name: 'Friday', game: 'Race Night' } }));
    live.terminate();
  });

  it('keeps the stored game when `game` is left out, and clears it with an empty string', async () => {
    await host('PUT', '/api/event', { name: 'Friday', game: 'Race Night' });
    expect((await host('PUT', '/api/event', { name: 'Friday night' })).json()).toEqual({ event: { name: 'Friday night', game: 'Race Night' } });
    expect((await host('PUT', '/api/event', { name: 'Friday night', game: '' })).json()).toEqual({ event: { name: 'Friday night', game: null } });
    expect(db.prepare('SELECT game FROM events').all()).toEqual([{ game: null }]);
    // Spaces alone are empty too.
    await host('PUT', '/api/event', { name: 'Friday night', game: 'Again' });
    expect((await host('PUT', '/api/event', { name: 'Friday night', game: '   ' })).json().event.game).toBeNull();
  });

  it('names the first event with the game when there is none yet', async () => {
    expect((await host('PUT', '/api/event', { name: 'First', game: 'Tag' })).json()).toEqual({ event: { name: 'First', game: 'Tag' } });
  });

  it.each([
    [{ name: 'Friday', game: 'x'.repeat(61) }],
    [{ name: 'Friday', game: 'a\u0000b' }],
    [{ name: 'Friday', game: 5 }],
    [{ name: 'Friday', game: null }],
    [{ name: 'Friday', game: 'ok', extra: 1 }],
  ])('answers 400 bad-request for the body %j and changes nothing', async (payload) => {
    await host('PUT', '/api/event', { name: 'Kept', game: 'Kept game' });
    const res = await host('PUT', '/api/event', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(await eventOf()).toEqual({ name: 'Kept', game: 'Kept game' });
  });
});

describe('GET and PUT /api/event/plan', () => {
  it('has no plan until one is saved, then gives it back field for field', async () => {
    expect(await planOf()).toBeNull();
    await host('PUT', '/api/event', { name: 'Friday' });
    expect(await planOf()).toBeNull();
    const plan: EventPlan = { ...planDefaults('racing'), stations: 3, hours: 5, noShowMinutes: 10 };
    const put = await host('PUT', '/api/event/plan', { plan });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toEqual({ plan });
    expect(await planOf()).toEqual(plan);
    expect(Object.keys((await planOf()) as object).sort()).toEqual(Object.keys(plan).sort());
  });

  it('makes the event when there is none, as ColiseumGrid, and tells the screens', async () => {
    const live = await listen(app, undefined, '127.0.0.1');
    expect((await host('PUT', '/api/event/plan', { plan: planDefaults('other') })).statusCode).toBe(200);
    expect(await eventOf()).toEqual({ name: 'ColiseumGrid', game: null });
    await eventually(() => expect(live.messages).toContainEqual({ type: 'event', event: { name: 'ColiseumGrid', game: null } }));
    live.terminate();
  });

  it('replaces the plan of the current event only', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    await host('PUT', '/api/event/plan', { plan: planDefaults('fighting') });
    await host('PUT', '/api/event/plan', { plan: { ...planDefaults('fighting'), stations: 4 } });
    expect(((await planOf()) as EventPlan).stations).toBe(4);
    expect(count('events')).toBe(1);
  });

  const good = planDefaults('fighting');
  const bad: Array<[string, unknown]> = [
    ['no plan', {}],
    ['a plan that is not an object', { plan: 'fighting' }],
    ['a null plan', { plan: null }],
    ['an unknown template', { plan: { ...good, template: 'party' } }],
    ['an unknown format', { plan: { ...good, format: 'swiss' } }],
    ['best of 2', { plan: { ...good, bestOf: 2 } }],
    ['5 games in a group', { plan: { ...good, races: 5 } }],
    ['0 rounds', { plan: { ...good, rounds: 0 } }],
    ['4 rounds', { plan: { ...good, rounds: 4 } }],
    ['a points table that rises', { plan: { ...good, points: [1, 2, 3, 4] } }],
    ['a points table of 3', { plan: { ...good, points: [4, 3, 2] } }],
    ['0 stations', { plan: { ...good, stations: 0 } }],
    ['9 stations', { plan: { ...good, stations: 9 } }],
    ['6 minutes a game', { plan: { ...good, minutesPerGame: 6 } }],
    ['a changeover of 3', { plan: { ...good, changeoverMinutes: 3 } }],
    ['0 hours', { plan: { ...good, hours: 0 } }],
    ['7 hours', { plan: { ...good, hours: 7 } }],
    ['a wait of 4', { plan: { ...good, noShowMinutes: 4 } }],
    ['a fraction', { plan: { ...good, stations: 1.5 } }],
    ['a string for a number', { plan: { ...good, hours: '3' } }],
    ['an extra field in the plan', { plan: { ...good, extra: true } }],
    ['an extra field in the body', { plan: good, extra: true }],
  ];
  it.each(bad)('answers 400 bad-request for %s and stores nothing', async (_label, payload) => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const res = await host('PUT', '/api/event/plan', payload as object);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(await planOf()).toBeNull();
  });

  it('answers 400 for a plan with a field left out', async () => {
    const { hours: _hours, ...short } = good;
    expect((await host('PUT', '/api/event/plan', { plan: short })).statusCode).toBe(400);
  });

  it('reads a stored plan that can\'t be read as no plan', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    for (const raw of ['not json', '{"template":"fighting"}', '[]', 'null', JSON.stringify({ ...good, stations: 99 })]) {
      db.prepare('UPDATE events SET plan = ?').run(raw);
      const res = await host('GET', '/api/event/plan');
      expect(res.statusCode, raw).toBe(200);
      expect(res.json(), raw).toEqual({ plan: null });
    }
  });
});

describe('the plan\'s noShowMinutes in the bracket and groups answers', () => {
  it('is 5 with no plan, and is the plan\'s once one is saved, in the start answer and every read', async () => {
    const made = (await host('POST', '/api/bracket', bracketBody())).json().bracket as Bracket;
    expect(made.noShowMinutes).toBe(NO_SHOW_DEFAULT);
    expect(NO_SHOW_DEFAULT).toBe(5);
    await host('PUT', '/api/event/plan', { plan: { ...planDefaults('fighting'), noShowMinutes: 15 } });
    expect(((await host('GET', '/api/bracket')).json().bracket as Bracket).noShowMinutes).toBe(15);
    const match = onStations(made)[0]!;
    const result = (await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player?.id })).json();
    expect(result.bracket.noShowMinutes).toBe(15);
    // A bracket started after the plan change says so at once.
    await host('DELETE', '/api/bracket');
    expect(((await host('POST', '/api/bracket', bracketBody())).json().bracket as Bracket).noShowMinutes).toBe(15);
    await host('DELETE', '/api/bracket');
    const heats = (await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)))).json().heats as Heats;
    expect(heats.noShowMinutes).toBe(15);
    await host('PUT', '/api/event/plan', { plan: { ...planDefaults('fighting'), noShowMinutes: 3 } });
    expect(((await host('GET', '/api/heats')).json().heats as Heats).noShowMinutes).toBe(3);
  });

  it('sends a payload-free plan message for every plan change, so a wizard open in another window reads it again', async () => {
    const live = await listen(app, undefined, '127.0.0.1');
    await host('PUT', '/api/event/plan', { plan: planDefaults('fighting') });
    await host('PUT', '/api/event/plan', { plan: { ...planDefaults('fighting'), stations: 2 } });
    // A refused plan is not a change.
    expect((await host('PUT', '/api/event/plan', { plan: { ...planDefaults('fighting'), stations: 99 } })).statusCode).toBe(400);
    await host('PUT', '/api/event', { name: 'Marker' });
    await eventually(() => expect(live.messages.at(-1)).toMatchObject({ type: 'event', event: { name: 'Marker' } }));
    expect(live.messages.filter((m) => m.type === 'plan')).toEqual([{ type: 'plan' }, { type: 'plan' }]);
    live.terminate();
  });

  it('tells the screens to reload the bracket and groups when the wait changes, and only then', async () => {
    const live = await listen(app, undefined, '127.0.0.1');
    await host('PUT', '/api/event/plan', { plan: planDefaults('fighting') });
    await host('PUT', '/api/event/plan', { plan: { ...planDefaults('fighting'), stations: 2 } });
    const marker = await host('PUT', '/api/event', { name: 'Marker' });
    expect(marker.statusCode).toBe(200);
    await eventually(() => expect(live.messages.at(-1)).toMatchObject({ type: 'event', event: { name: 'Marker' } }));
    expect(live.messages.filter((m) => m.type === 'bracket' || m.type === 'heats')).toEqual([]);
    await host('PUT', '/api/event/plan', { plan: { ...planDefaults('fighting'), noShowMinutes: 10 } });
    await eventually(() => expect(live.messages.filter((m) => m.type === 'bracket' || m.type === 'heats').map((m) => m.type)).toEqual(['bracket', 'heats']));
    live.terminate();
  });
});

describe('POST /api/events', () => {
  it('makes the new current event and answers 201 with it', async () => {
    await host('PUT', '/api/event', { name: 'Friday', game: 'Race Night' });
    const res = await host('POST', '/api/events', { name: '  Saturday   Cup ' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ event: { name: 'Saturday Cup', game: null } });
    expect(await eventOf()).toEqual({ name: 'Saturday Cup', game: null });
    expect(db.prepare('SELECT name, game FROM events ORDER BY id').all()).toEqual([
      { name: 'Friday', game: 'Race Night' },
      { name: 'Saturday Cup', game: null },
    ]);
  });

  it('takes a game, cleaned like the event name, and stores an empty one as none', async () => {
    expect((await host('POST', '/api/events', { name: 'A', game: ' Tag  Time ' })).json().event).toEqual({ name: 'A', game: 'Tag Time' });
    expect((await host('POST', '/api/events', { name: 'B', game: '' })).json().event).toEqual({ name: 'B', game: null });
  });

  it('works with no event yet, and copies the current plan and not the game', async () => {
    expect((await host('POST', '/api/events', { name: 'First' })).statusCode).toBe(201);
    expect(await planOf()).toBeNull();
    const plan: EventPlan = { ...planDefaults('racing'), stations: 6, noShowMinutes: 15 };
    await host('PUT', '/api/event', { name: 'First', game: 'Race Night' });
    await host('PUT', '/api/event/plan', { plan });
    await host('POST', '/api/events', { name: 'Second' });
    expect(await planOf()).toEqual(plan);
    expect(await eventOf()).toEqual({ name: 'Second', game: null });
    // The old event keeps its own plan and game.
    expect(db.prepare('SELECT game, plan FROM events ORDER BY id').all()).toEqual([
      { game: 'Race Night', plan: JSON.stringify(plan) },
      { game: null, plan: JSON.stringify(plan) },
    ]);
  });

  it('does not copy a plan that can\'t be read', async () => {
    await host('PUT', '/api/event', { name: 'First' });
    db.prepare("UPDATE events SET plan = 'not json'").run();
    await host('POST', '/api/events', { name: 'Second' });
    expect(db.prepare('SELECT plan FROM events ORDER BY id').all()).toEqual([{ plan: 'not json' }, { plan: null }]);
  });

  it.each([
    [{}],
    [{ name: '' }],
    [{ name: '   ' }],
    [{ name: 'x'.repeat(61) }],
    [{ name: 'a\u0000b' }],
    [{ name: 5 }],
    [{ name: 'Fine', game: 'x'.repeat(61) }],
    [{ name: 'Fine', game: 'a\u0000b' }],
    [{ name: 'Fine', game: 5 }],
    [{ name: 'Fine', extra: true }],
  ])('answers 400 bad-request for the body %j and makes no event', async (payload) => {
    await host('PUT', '/api/event', { name: 'Kept' });
    const res = await host('POST', '/api/events', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(count('events')).toBe(1);
  });

  it('keeps the old event\'s bracket untouched, and shows no players until they sign up again', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    expect((await host('GET', '/api/event/players')).json().playerIds).toEqual([]);
    const made = (await host('POST', '/api/bracket', bracketBody(4))).json().bracket as Bracket;
    const match = onStations(made)[0]!;
    await host('POST', '/api/bracket/results', { matchId: match.id, winnerId: match.slots[0].player?.id });
    expect((await host('GET', '/api/event/players')).json().playerIds).toHaveLength(4);
    const rows = () => ({
      brackets: db.prepare('SELECT * FROM brackets').all(),
      results: db.prepare('SELECT * FROM bracket_results').all(),
      players: db.prepare('SELECT * FROM event_players ORDER BY player_id').all(),
    });
    const before = rows();
    // The bracket isn't finished, so a new event is refused; finish it first.
    expect((await host('POST', '/api/events', { name: 'Saturday' })).statusCode).toBe(409);
    expect(rows()).toEqual(before);
    for (let guard = 0; guard < 20; guard++) {
      const live = ((await host('GET', '/api/bracket')).json().bracket as Bracket);
      const next = onStations(live)[0];
      if (!next) break;
      await host('POST', '/api/bracket/results', { matchId: next.id, winnerId: next.slots[0].player?.id });
    }
    expect(((await host('GET', '/api/bracket')).json().bracket as Bracket).finished).toBe(true);
    const finished = rows();

    expect((await host('POST', '/api/events', { name: 'Saturday' })).statusCode).toBe(201);
    // The old event's bracket, its results, and who was in the event are as they were.
    expect(rows()).toEqual(finished);
    // The new event has no bracket, no groups, and no players.
    expect((await host('GET', '/api/bracket')).json().bracket).toBeNull();
    expect((await host('GET', '/api/heats')).json().heats).toBeNull();
    expect((await host('GET', '/api/event/players')).json()).toEqual({ playerIds: [] });
    // A returning player signs up again, and is then in the new event only.
    const res = await callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: '1234' });
    expect([200, 201]).toContain(res.statusCode);
    expect((await host('GET', '/api/event/players')).json().playerIds).toEqual([ids[0]]);
    // And a new competition can start in it.
    expect((await host('POST', '/api/bracket', bracketBody(4))).statusCode).toBe(201);
    expect(count('brackets')).toBe(2);
  });

  it('answers 409 bracket-running while a bracket is being played, and while groups are', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    await host('POST', '/api/bracket', bracketBody(4));
    let res = await host('POST', '/api/events', { name: 'Saturday' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'bracket-running' });
    expect(count('events')).toBe(1);

    await host('DELETE', '/api/bracket');
    await host('POST', '/api/heats', heatsBody(ids.slice(0, 5)));
    res = await host('POST', '/api/events', { name: 'Saturday' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'bracket-running' });
    expect(count('events')).toBe(1);
    expect(await eventOf()).toEqual({ name: 'Friday', game: null });
  });

  it('is allowed once the competition is finished, whichever kind it was', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    await host('POST', '/api/heats', heatsBody(ids.slice(0, 3)));
    for (let guard = 0; guard < 10; guard++) {
      const heats = (await host('GET', '/api/heats')).json().heats as Heats;
      const next = heats.stations.find((s) => s.heat)?.heat;
      if (!next) break;
      await host('POST', '/api/heats/results', { heatId: next.id, order: next.players.map((p) => p.id) });
    }
    expect(((await host('GET', '/api/heats')).json().heats as Heats).finished).toBe(true);
    expect((await host('POST', '/api/events', { name: 'Saturday' })).statusCode).toBe(201);
    expect(count('heat_runs')).toBe(1);
  });

  it('tells every screen: event, players, bracket, and heats', async () => {
    const live = await listen(app, undefined, '127.0.0.1');
    const phone = await signInPhone(app, 'Player1');
    const phoneLive = await listen(app, phone.cookie, PHONE_IP);
    await host('POST', '/api/events', { name: 'Saturday', game: 'Tag' });
    for (const connection of [live, phoneLive]) {
      await eventually(() =>
        expect(connection.messages).toEqual([
          { type: 'event', event: { name: 'Saturday', game: 'Tag' } },
          { type: 'players' },
          { type: 'bracket' },
          { type: 'heats' },
          { type: 'plan' },
        ]),
      );
    }
    live.terminate();
    phoneLive.terminate();
  });

  it('runs a new event and a start that race one after the other: the start lands in the new event, or the event is refused', async () => {
    await host('PUT', '/api/event', { name: 'Friday' });
    const [event, bracket] = await Promise.all([host('POST', '/api/events', { name: 'Saturday' }), host('POST', '/api/bracket', bracketBody(4))]);
    expect(bracket.statusCode).toBe(201);
    const owner = db.prepare('SELECT e.name FROM brackets b JOIN events e ON e.id = b.event_id').get();
    if (event.statusCode === 201) {
      expect(owner).toEqual({ name: 'Saturday' });
    } else {
      expect(event.statusCode).toBe(409);
      expect(owner).toEqual({ name: 'Friday' });
      expect(count('events')).toBe(1);
    }
    // Either way the bracket is running now, so a new event is refused.
    expect((await host('POST', '/api/events', { name: 'Sunday' })).statusCode).toBe(409);
  });
});

describe('the new answers\' schemas', () => {
  // A field added to a handler must be added to the schema too, or it never leaves the server
  // (CLAUDE.md, rule 1). That only holds if no object in the schema allows extras.
  it('close every object', () => {
    const open: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${path}[${i}]`));
      else if (node && typeof node === 'object') {
        const schema = node as Record<string, unknown>;
        if (schema['type'] === 'object' && schema['additionalProperties'] !== false) open.push(path);
        for (const [key, value] of Object.entries(schema)) walk(value, `${path}.${key}`);
      }
    };
    walk(planSchema, 'plan');
    walk(eventInfoSchema, 'event');
    walk(nullableEventSchema, 'nullable event');
    expect(open).toEqual([]);
  });

  it('list the plan\'s fields exactly as core\'s EventPlan has them', () => {
    expect(Object.keys(planSchema.properties).sort()).toEqual(Object.keys(planDefaults('fighting')).sort());
    expect([...planSchema.required].sort()).toEqual(Object.keys(planDefaults('fighting')).sort());
  });
});

describe('the events store', () => {
  it('reads a plan back through isEventPlan and copies only a readable one', () => {
    const events = createEvents(openDatabase(':memory:'), () => 0);
    expect(events.plan()).toBeNull();
    events.setName('One', 'Tag');
    expect(events.current()).toEqual({ name: 'One', game: 'Tag' });
    events.setPlan(planDefaults('fighting'));
    expect(events.create('Two')).toEqual({ name: 'Two', game: null });
    expect(events.plan()).toEqual(planDefaults('fighting'));
  });
});

