// Live for phones (docs/PLAN.md, "Phone API", "Live"): who may connect, what a phone is sent,
// the "two away" status reaching a phone within a second, and a phone being closed when it is
// signed out. Like live.test.ts it uses injectWS, so no port is opened.

import type { Bracket, Heats, PhoneAnswer } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { makeCallers, onStations, type Callers } from './bracket-api-helpers.ts';
import { heatsBody } from './heat-api-helpers.ts';
import { pairDevice } from './helpers.ts';
import { PHONE_IP, PIN, addPinPlayers, eventually, listen, otherIp, signInPhone, type Live } from './phone-helpers.ts';

let app: FastifyInstance;
let db: Database;
let callers: Callers;
let ids: number[];
const open: Live[] = [];

const connect = async (cookie: string | undefined, ip = PHONE_IP, headers: Record<string, string> = {}): Promise<Live> => {
  const live = await listen(app, cookie, ip, headers);
  open.push(live);
  return live;
};

async function startApp(heartbeatMs?: number): Promise<void> {
  db = openDatabase(':memory:');
  app = await buildApp({ db, ...(heartbeatMs && { liveHeartbeatMs: heartbeatMs }) });
  await app.ready();
  callers = await makeCallers(app);
  ids = addPinPlayers(db, 8);
}

beforeEach(() => startApp());
afterEach(async () => {
  for (const live of open.splice(0)) live.terminate();
  await app.close();
});

describe('who may connect', () => {
  it('accepts a phone, and refuses no cookie, a made-up cookie, and a stale one', async () => {
    const phone = await signInPhone(app, 'Player1');
    expect((await connect(phone.cookie)).closed).toBeUndefined();
    await expect(connect(undefined)).rejects.toThrow(/401/);
    await expect(connect('cg_phone=garbage')).rejects.toThrow(/401/);
    await phone.api('POST', '/api/phone/sign-out');
    await expect(connect(phone.cookie)).rejects.toThrow(/401/);
  });

  it('refuses a handshake from a page on another origin, even with a phone cookie', async () => {
    const phone = await signInPhone(app, 'Player1');
    await expect(connect(phone.cookie, PHONE_IP, { origin: 'http://evil.example.com' })).rejects.toThrow(/403/);
    expect((await connect(phone.cookie, PHONE_IP, { origin: 'http://localhost' })).closed).toBeUndefined();
  });
});

describe('what a phone is sent', () => {
  it('gets the broadcasts every screen gets, and none of them carries a player', async () => {
    const phone = await signInPhone(app, 'Player1');
    const live = await connect(phone.cookie);
    await callers.host('PUT', '/api/event', { name: 'Friday' });
    await callers.host('POST', '/api/players', { handle: 'Added' });
    await callers.host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 4) });
    await callers.host('DELETE', '/api/bracket');
    await callers.host('POST', '/api/heats', heatsBody(ids.slice(4, 8)));
    await eventually(() => expect(live.messages.map((m) => m.type)).toEqual(['event', 'players', 'bracket', 'bracket', 'heats']));
    expect(JSON.stringify(live.messages)).not.toContain('Player');
  });
});

describe('two away', () => {
  /** The players of a match, to follow with a phone. */
  const playerOf = (m: Bracket['upNext'][number]) => m.slots[0].player!;

  it('reaches a phone within a second of the result, over live and on GET /api/phone (bracket)', async () => {
    const made = (await callers.host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids })).json().bracket as Bracket;
    const onStation = onStations(made)[0]!;
    // Third in Up next is 3 away; once the match on the station is done it is 2 away.
    const third = playerOf(made.upNext[2]!);
    const phones = [await signInPhone(app, third.handle), await signInPhone(app, third.handle, otherIp(2))];
    const lives = await Promise.all(phones.map((p, i) => connect(p.cookie, i === 0 ? PHONE_IP : otherIp(2))));
    const before = (await phones[0]!.api('GET', '/api/phone')).json() as PhoneAnswer;
    expect(before.following[0]).toMatchObject({ status: 'later', away: 3 });

    const started = Date.now();
    const res = await callers.host('POST', '/api/bracket/results', { matchId: onStation.id, winnerId: onStation.slots[0].player!.id });
    expect(res.statusCode).toBe(200);
    for (const live of lives) await eventually(() => expect(live.messages.some((m) => m.type === 'bracket')).toBe(true));
    for (const phone of phones) {
      const now = (await phone.api('GET', '/api/phone')).json() as PhoneAnswer;
      expect(now.following[0]).toMatchObject({ status: 'two-away', away: 2 });
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('reaches a phone within a second over live and on GET /api/phone (heats)', async () => {
    // 20 players make 5 heats in the first round, so the queue is 4 deep behind the station.
    const more = addPinPlayers(db, 12, 9);
    const made = (await callers.host('POST', '/api/heats', heatsBody([...ids, ...more], { stations: 1 }))).json().heats as Heats;
    const heat = made.stations[0]!.heat!;
    const third = made.upNext[2]!.players[0]!;
    const phone = await signInPhone(app, third.handle);
    const live = await connect(phone.cookie);
    expect(((await phone.api('GET', '/api/phone')).json() as PhoneAnswer).following[0]).toMatchObject({ status: 'later', away: 3 });

    const started = Date.now();
    const res = await callers.host('POST', '/api/heats/results', { heatId: heat.id, order: heat.players.map((p) => p.id) });
    expect(res.statusCode).toBe(200);
    await eventually(() => expect(live.messages.some((m) => m.type === 'heats')).toBe(true));
    expect(((await phone.api('GET', '/api/phone')).json() as PhoneAnswer).following[0]).toMatchObject({ status: 'two-away', away: 2 });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('signing out', () => {
  it('sends unpaired and closes the phone, and leaves other phones connected', async () => {
    const a = await signInPhone(app, 'Player1');
    const b = await signInPhone(app, 'Player2', otherIp(2));
    const liveA = await connect(a.cookie);
    const liveB = await connect(b.cookie, otherIp(2));
    await a.api('POST', '/api/phone/sign-out');
    await eventually(() => expect(liveA.closed).toBeDefined());
    expect(liveA.messages).toContainEqual({ type: 'unpaired' });
    expect(liveB.closed).toBeUndefined();
    expect(liveB.messages).not.toContainEqual({ type: 'unpaired' });
  });

  it('does the same when the last follow is stopped, and not when others remain', async () => {
    const phone = await signInPhone(app, 'Player1');
    await phone.api('POST', '/api/phone/follow', { handle: 'Player2', pin: PIN });
    const live = await connect(phone.cookie);
    await phone.api('DELETE', `/api/phone/follow/${ids[0]}`);
    await new Promise((r) => setTimeout(r, 30));
    expect(live.closed).toBeUndefined();
    await phone.api('DELETE', `/api/phone/follow/${ids[1]}`);
    await eventually(() => expect(live.closed).toBeDefined());
    expect(live.messages).toContainEqual({ type: 'unpaired' });
  });

  it('does it when a PIN reset leaves the phone following nobody, and not when it still follows someone', async () => {
    const left = await signInPhone(app, 'Player1');
    const stays = await signInPhone(app, 'Player1', otherIp(2));
    await stays.api('POST', '/api/phone/follow', { handle: 'Player2', pin: PIN });
    const liveLeft = await connect(left.cookie);
    const liveStays = await connect(stays.cookie, otherIp(2));
    await callers.host('POST', `/api/players/${ids[0]}/reset-pin`);
    await eventually(() => expect(liveLeft.closed).toBeDefined());
    expect(liveLeft.messages).toContainEqual({ type: 'unpaired' });
    await new Promise((r) => setTimeout(r, 30));
    expect(liveStays.closed).toBeUndefined();
  });
});

describe('a browser that holds more than one identity', () => {
  const LAPTOP = '127.0.0.1';
  const receivesBroadcast = async (live: Live): Promise<void> => {
    expect((await callers.host('PUT', '/api/event', { name: `Night ${live.messages.length}` })).statusCode).toBe(200);
    await eventually(() => expect(live.messages.some((m) => m.type === 'event')).toBe(true));
  };

  it('stays connected when the phone signs out, if the browser is also the laptop', async () => {
    const phone = await signInPhone(app, 'Player1');
    const live = await connect(phone.cookie, LAPTOP);
    expect((await phone.api('POST', '/api/phone/sign-out')).statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 50));
    expect(live.closed).toBeUndefined();
    expect(live.messages).not.toContainEqual({ type: 'unpaired' });
    await receivesBroadcast(live);
  });

  it('stays connected when the phone signs out, if the browser is also a paired Display; unpairing the Display then ends it', async () => {
    const phone = await signInPhone(app, 'Player1');
    const { cookie, device } = await pairDevice(app, '', 'display', LAPTOP);
    const live = await connect(`${cookie}; ${phone.cookie}`);
    expect((await phone.api('POST', '/api/phone/sign-out')).statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 50));
    expect(live.closed).toBeUndefined();
    expect(live.messages).not.toContainEqual({ type: 'unpaired' });
    await receivesBroadcast(live);
    expect((await callers.host('DELETE', `/api/devices/${device.id}`)).statusCode).toBe(204);
    await eventually(() => expect(live.closed).toBeDefined());
    expect(live.messages).toContainEqual({ type: 'unpaired' });
  });

  it('stays connected when the Display is unpaired, if the browser is also a phone; signing out the phone then ends it', async () => {
    const phone = await signInPhone(app, 'Player1');
    const { cookie, device } = await pairDevice(app, '', 'display', LAPTOP);
    const live = await connect(`${cookie}; ${phone.cookie}`);
    expect((await callers.host('DELETE', `/api/devices/${device.id}`)).statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 50));
    expect(live.closed).toBeUndefined();
    expect(live.messages).not.toContainEqual({ type: 'unpaired' });
    await receivesBroadcast(live);
    expect((await phone.api('POST', '/api/phone/sign-out')).statusCode).toBe(204);
    await eventually(() => expect(live.closed).toBeDefined());
    expect(live.messages).toContainEqual({ type: 'unpaired' });
  });
});

describe('the heartbeat', () => {
  it('closes a phone whose row is gone, with the policy code', async () => {
    await app.close();
    await startApp(20);
    const phone = await signInPhone(app, 'Player1');
    const live = await connect(phone.cookie);
    db.prepare('DELETE FROM phones').run();
    await eventually(() => expect(live.closed).toEqual({ code: 1008 }), 2000);
  });
});
