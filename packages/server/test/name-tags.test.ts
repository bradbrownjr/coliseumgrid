// The print queue (docs/PLAN.md, "The print queue" and "Name tags API"): what queues a tag and
// with which PIN, reprints, "Yes, they printed", merges, new events, who may call the routes,
// and who hears about a change. The 12-hour wipe and the PIN leaving the database file are in
// tag-pins.test.ts; the graphic is in graphic.test.ts.

import type { NameTag } from '@coliseumgrid/core';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { makeCallers, type Api, type Callers } from './bracket-api-helpers.ts';
import { cookieFrom } from './helpers.ts';
import { PIN, addPinPlayers, eventually, listen, signInPhone, type Live, type Phone } from './phone-helpers.ts';

let app: FastifyInstance;
let db: Database;
let callers: Callers;
/** The laptop, which is the host offline. */
let host: Api;

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  await app.ready();
  callers = await makeCallers(app);
  host = callers.host;
});
afterEach(() => app.close());

/** The queue as the host reads it, with each tag's version. */
const listed = async (): Promise<NameTag[]> => {
  const res = await host('GET', '/api/tags');
  expect(res.statusCode).toBe(200);
  return res.json().tags;
};
/** The same without versions, for the tests about who is queued and with which PIN. */
const tags = async (): Promise<Omit<NameTag, 'version'>[]> => (await listed()).map(({ version: _version, ...tag }) => tag);
const printed = (...of: NameTag[]) => host('POST', '/api/tags/printed', { tags: of.map(({ playerId, version }) => ({ playerId, version })) });
const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const queueRows = () => db.prepare('SELECT player_id, pin, pin_stored_at FROM tag_queue ORDER BY player_id').all();

async function signUp(handle: string, pin: string, who: Api = callers.signup): Promise<number> {
  const res = await who('POST', '/api/signup', { handle, pin });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().player.id;
}

describe('what queues a tag', () => {
  it('a sign-up, with the PIN the player chose', async () => {
    const id = await signUp('Zap', '4821');
    expect(await tags()).toEqual([{ playerId: id, handle: 'Zap', pin: '4821' }]);
  });

  it('a claim on the Sign-up screen, with the PIN the player proved', async () => {
    const [id] = addPinPlayers(db, 1);
    expect(await tags()).toEqual([]);
    const res = await callers.signup('POST', '/api/signup/claim', { handle: 'player1', pin: PIN });
    expect(res.statusCode).toBe(200);
    expect(await tags()).toEqual([{ playerId: id, handle: 'Player1', pin: PIN }]);
  });

  it('not a wrong claim', async () => {
    addPinPlayers(db, 1);
    expect((await callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: '9999' })).statusCode).toBe(401);
    expect(await tags()).toEqual([]);
  });

  it('a host add, with the PIN the host was shown', async () => {
    const res = await host('POST', '/api/players', { handle: 'Added' });
    expect(res.statusCode).toBe(201);
    const { player, pin } = res.json();
    expect(await tags()).toEqual([{ playerId: player.id, handle: 'Added', pin }]);
  });

  it('a PIN reset, which replaces the queued tag and keeps the newest PIN', async () => {
    const id = await signUp('Zap', '4821');
    const first = (await host('POST', `/api/players/${id}/reset-pin`)).json().pin as string;
    expect(await tags()).toEqual([{ playerId: id, handle: 'Zap', pin: first }]);
    const second = (await host('POST', `/api/players/${id}/reset-pin`)).json().pin as string;
    expect(await tags()).toEqual([{ playerId: id, handle: 'Zap', pin: second }]);
    // One tag per player.
    expect(count('tag_queue')).toBe(1);
  });

  it('a PIN reset of a player whose tag already printed', async () => {
    const id = await signUp('Zap', '4821');
    await printed(...(await listed()));
    const pin = (await host('POST', `/api/players/${id}/reset-pin`)).json().pin as string;
    expect(await tags()).toEqual([{ playerId: id, handle: 'Zap', pin }]);
  });

  it('nothing for a refused sign-up or an unknown player', async () => {
    expect((await callers.signup('POST', '/api/signup', { handle: 'Zap', pin: '12' })).statusCode).toBe(400);
    expect((await host('POST', '/api/players/99/reset-pin')).statusCode).toBe(404);
    expect(count('tag_queue')).toBe(0);
  });

  it('sorts the queue by handle, whatever the case', async () => {
    const b = await signUp('bolt', '1111');
    const z = await signUp('Zap', '2222');
    const a = await signUp('Arrow', '3333');
    expect((await tags()).map((t) => t.playerId)).toEqual([a, b, z]);
  });

  it('shows the current handle after a rename', async () => {
    const id = await signUp('Zap', '4821');
    await host('PATCH', `/api/players/${id}`, { handle: 'Zapper' });
    expect(await tags()).toEqual([{ playerId: id, handle: 'Zapper', pin: '4821' }]);
  });
});

describe('POST /api/tags (a reprint)', () => {
  it('queues the tag with no PIN and answers 201 with it', async () => {
    const [id] = addPinPlayers(db, 1);
    const res = await host('POST', '/api/tags', { playerId: id });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ tag: { playerId: id, handle: 'Player1', pin: null, version: expect.any(Number) } });
    expect(Object.keys(res.json().tag).sort()).toEqual(['handle', 'pin', 'playerId', 'version']);
    expect(queueRows()).toEqual([{ player_id: id, pin: null, pin_stored_at: null }]);
  });

  it('keeps a PIN already waiting to print, so the newest PIN still prints', async () => {
    const id = await signUp('Zap', '4821');
    const stored = queueRows();
    const res = await host('POST', '/api/tags', { playerId: id });
    expect(res.json()).toEqual({ tag: { playerId: id, handle: 'Zap', pin: '4821', version: expect.any(Number) } });
    // The 12 hours still count from when the PIN was seen.
    expect(queueRows()).toEqual(stored);
  });

  it('answers 404 for an unknown player, and 400 for a body outside the schema', async () => {
    expect((await host('POST', '/api/tags', { playerId: 99 })).json()).toEqual({ error: 'not-found' });
    for (const body of [{}, { playerId: '1' }, { playerId: 0 }, { playerId: 1, pin: '1234' }]) {
      const res = await host('POST', '/api/tags', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    expect(count('tag_queue')).toBe(0);
  });
});

describe('POST /api/tags/printed ("Yes")', () => {
  it('deletes the tags whose id and version match, with their PINs, and keeps the others', async () => {
    const a = await signUp('Arrow', '1111');
    const b = await signUp('Bolt', '2222');
    const [arrow, bolt] = await listed();
    const res = await host('POST', '/api/tags/printed', { tags: [{ playerId: a, version: arrow!.version }, { playerId: 999, version: 1 }] });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await listed()).toEqual([bolt]);
    expect(bolt).toMatchObject({ playerId: b, pin: '2222' });
    expect(db.prepare('SELECT pin FROM tag_queue').all()).toEqual([{ pin: '2222' }]);
  });

  it('keeps a tag when only its id or only its version matches', async () => {
    const id = await signUp('Zap', '4821');
    const [tag] = await listed();
    await host('POST', '/api/tags/printed', { tags: [{ playerId: id, version: tag!.version + 1 }, { playerId: id + 1, version: tag!.version }] });
    expect(await listed()).toEqual([tag]);
  });

  it('gives every queueing a higher version, and never reuses a deleted tag\'s', async () => {
    const id = await signUp('Zap', '4821');
    const seen = [(await listed())[0]!.version];
    await host('POST', '/api/tags', { playerId: id });
    seen.push((await listed())[0]!.version);
    await printed(...(await listed()));
    await host('POST', '/api/tags', { playerId: id });
    seen.push((await listed())[0]!.version);
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
    expect(new Set(seen).size).toBe(3);
  });

  // The host reads the queue, prints, and answers Yes some time later. A tag queued again in
  // between is a new tag, possibly with a new PIN that was never on the paper.
  describe('a change between the host reading the queue and answering Yes', () => {
    it('a PIN reset leaves the new tag and its new PIN queued', async () => {
      const id = await signUp('Zap', '4821');
      const read = await listed();
      const pin = (await host('POST', `/api/players/${id}/reset-pin`)).json().pin as string;
      expect((await printed(...read)).statusCode).toBe(204);
      expect(await tags()).toEqual([{ playerId: id, handle: 'Zap', pin }]);
    });

    it('a claim leaves the new tag queued', async () => {
      const [id] = addPinPlayers(db, 1);
      await host('POST', '/api/tags', { playerId: id });
      const read = await listed();
      expect((await callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: PIN })).statusCode).toBe(200);
      expect((await printed(...read)).statusCode).toBe(204);
      expect(await tags()).toEqual([{ playerId: id, handle: 'Player1', pin: PIN }]);
    });

    it('a reprint leaves the tag queued', async () => {
      const id = await signUp('Zap', '4821');
      const read = await listed();
      expect((await host('POST', '/api/tags', { playerId: id })).statusCode).toBe(201);
      expect((await printed(...read)).statusCode).toBe(204);
      expect(await tags()).toEqual([{ playerId: id, handle: 'Zap', pin: '4821' }]);
    });

    it('nothing changed: the matching pair is deleted', async () => {
      await signUp('Zap', '4821');
      expect((await printed(...(await listed()))).statusCode).toBe(204);
      expect(await tags()).toEqual([]);
    });
  });

  it('takes an empty list, and refuses a body outside the schema', async () => {
    expect((await host('POST', '/api/tags/printed', { tags: [] })).statusCode).toBe(204);
    const one = { playerId: 1, version: 1 };
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ playerId: i + 1, version: 1 }));
    for (const body of [
      {},
      { playerIds: [1] },
      { tags: [{ playerId: 0, version: 1 }] },
      { tags: [{ playerId: 1, version: 0 }] },
      { tags: [{ playerId: '1', version: 1 }] },
      { tags: [{ playerId: 1 }] },
      { tags: [{ ...one, pin: '1234' }] },
      { tags: [one], all: true },
      { tags: tooMany },
    ]) {
      expect((await host('POST', '/api/tags/printed', body)).statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
  });
});

describe('GET /api/tags', () => {
  it('is never stored by a browser or a proxy, because it holds plain PINs', async () => {
    await signUp('Zap', '4821');
    const res = await host('GET', '/api/tags');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('leaving the queue', () => {
  it('a merged player\'s tag leaves; the kept player\'s stays', async () => {
    const merged = await signUp('Zap', '1111');
    const kept = await signUp('Bolt', '2222');
    expect((await host('POST', `/api/players/${merged}/merge`, { intoId: kept })).statusCode).toBe(200);
    expect(await tags()).toEqual([{ playerId: kept, handle: 'Bolt', pin: '2222' }]);
  });

  it('a new event empties the queue', async () => {
    await signUp('Zap', '1111');
    await host('POST', '/api/tags', { playerId: addPinPlayers(db, 1)[0] });
    expect(count('tag_queue')).toBe(2);
    expect((await host('POST', '/api/events', { name: 'Saturday' })).statusCode).toBe(201);
    expect(await tags()).toEqual([]);
    expect(count('tag_queue')).toBe(0);
  });

  it('a refused new event leaves the queue as it was', async () => {
    await signUp('Zap', '1111');
    expect((await host('POST', '/api/events', { name: '' })).statusCode).toBe(400);
    expect(count('tag_queue')).toBe(1);
  });
});

describe('who may use the tags routes', () => {
  let phone: Phone;
  beforeEach(async () => {
    addPinPlayers(db, 1);
    phone = await signInPhone(app, 'Player1');
  });

  it.each([
    ['GET', '/api/tags', undefined],
    ['POST', '/api/tags', { playerId: 1 }],
    ['POST', '/api/tags/printed', { tags: [{ playerId: 1, version: 1 }] }],
  ] as const)('%s %s answers 401 not-signed-in to a phone, a Sign-up device, a Display, and a stranger', async (method, url, payload) => {
    await signUp('Zap', '4821');
    const before = queueRows();
    for (const [name, who] of [['phone', phone.api], ['signup', callers.signup], ['display', callers.display], ['stranger', callers.nobody]] as const) {
      const res = await who(method, url, payload);
      expect(res.statusCode, `${name} ${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
      expect(res.body, name).not.toContain('4821');
    }
    expect(queueRows()).toEqual(before);
  });

  it('the Sign-up device\'s own answers never carry the queue or the PIN', async () => {
    // POST /api/signup/check suggests a PIN by design, so it isn't in the list.
    const answers: LightMyRequestResponse[] = [
      await callers.signup('POST', '/api/signup', { handle: 'Zap', pin: '4821' }),
      await callers.signup('POST', '/api/signup/claim', { handle: 'Zap', pin: '4821' }),
    ];
    for (const res of answers) {
      expect(res.statusCode).toBeLessThan(300);
      expect(res.body).not.toContain('4821');
      expect(res.body).not.toContain('tag');
    }
  });
});

describe('the tags live message', () => {
  const open: Live[] = [];
  afterEach(() => {
    for (const live of open.splice(0)) live.terminate();
  });
  const connect = async (cookie: string | undefined, remoteAddress: string): Promise<Live> => {
    const live = await listen(app, cookie, remoteAddress);
    open.push(live);
    return live;
  };
  /** A cookie for a new device of the role, paired from the laptop. */
  async function deviceCookie(role: 'display' | 'signup'): Promise<string> {
    const code = (await host('POST', '/api/pairing/codes', { role })).json().code as string;
    return cookieFrom(await app.inject({ method: 'POST', url: '/api/devices/join', payload: { code }, remoteAddress: '198.51.100.9' }));
  }
  const tagMessages = (live: Live): number => live.messages.filter((m) => m.type === 'tags').length;

  it('goes to host screens on every queue change, and never to a phone, a Display, or a Sign-up device', async () => {
    addPinPlayers(db, 1);
    const phone = await signInPhone(app, 'Player1');
    const laptop = await connect(undefined, '127.0.0.1');
    const others = [await connect(phone.cookie, '198.51.100.20'), await connect(await deviceCookie('display'), '198.51.100.9'), await connect(await deviceCookie('signup'), '198.51.100.9')];

    const id = await signUp('Zap', '4821');
    await eventually(() => expect(tagMessages(laptop)).toBe(1));
    await host('POST', `/api/players/${id}/reset-pin`);
    await host('POST', '/api/tags', { playerId: id });
    await printed(...(await listed()));
    await callers.signup('POST', '/api/signup/claim', { handle: 'Zap', pin: (await host('POST', `/api/players/${id}/reset-pin`)).json().pin });
    await host('POST', '/api/players', { handle: 'Added' });
    await host('POST', '/api/events', { name: 'Saturday' });
    // Sign-up, reset, reprint, printed, reset, claim, add, new event.
    await eventually(() => expect(tagMessages(laptop)).toBe(8));
    expect(laptop.messages.filter((m) => m.type === 'tags')).toEqual(Array.from({ length: 8 }, () => ({ type: 'tags' })));

    // The new event's broadcast reached every screen after the tag messages were sent, so a tag
    // message meant for them would have arrived by now.
    for (const live of others) await eventually(() => expect(live.messages.some((m) => m.type === 'plan')).toBe(true));
    for (const live of others) {
      expect(tagMessages(live)).toBe(0);
      expect(JSON.stringify(live.messages)).not.toContain('4821');
    }
  });

  it('is not sent when nothing in the queue changed', async () => {
    const laptop = await connect(undefined, '127.0.0.1');
    await host('POST', '/api/tags/printed', { tags: [{ playerId: 1, version: 1 }, { playerId: 2, version: 1 }] });
    await host('POST', '/api/events', { name: 'Saturday' });
    await eventually(() => expect(laptop.messages.some((m) => m.type === 'plan')).toBe(true));
    expect(tagMessages(laptop)).toBe(0);
  });
});
