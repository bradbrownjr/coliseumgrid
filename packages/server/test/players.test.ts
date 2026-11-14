import { JOIN_CODE_ALPHABET } from '@coliseumgrid/core';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { verifyPin } from '../src/pin-hash.ts';

// The app runs offline and app.inject comes from 127.0.0.1, so every request here counts as the
// laptop, which is the host. Who may call which route is tested in access.test.ts.
/** The code a sign-up or a claim answers with (docs/PLAN.md, "Phone API"). */
const FOLLOW_CODE = { code: expect.stringMatching(new RegExp(`^[${JOIN_CODE_ALPHABET}]{6}$`)), expiresAt: expect.any(String) };
let app: FastifyInstance;
let db: Database;
/** Every response body the test saw, to check what leaves the server. */
let bodies: string[];

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  bodies = [];
});
afterEach(() => app.close());

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  bodies.push(res.body);
  return res;
}

const post = (url: string, payload?: unknown) => call('POST', url, payload);

async function signUp(handle: string, pin = '1234'): Promise<{ id: number; handle: string }> {
  const res = await post('/api/signup', { handle, pin });
  expect(res.statusCode).toBe(201);
  return res.json().player;
}

describe('POST /api/signup/check', () => {
  it('says an unused handle is available and suggests a 4-digit PIN', async () => {
    const res = await post('/api/signup/check', { handle: '  Zap   Man ' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ status: 'available', handle: 'Zap Man', suggestedPin: expect.stringMatching(/^[0-9]{4}$/) });
  });

  it('says a taken handle is taken, in any case, without a PIN', async () => {
    await signUp('Zap');
    const res = await post('/api/signup/check', { handle: 'ZAP' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'taken', handle: 'ZAP' });
  });

  it.each([
    ['A', 'too-short'],
    ['A'.repeat(17), 'too-long'],
    ['Zap!', 'bad-characters'],
    ['FUCK', 'not-allowed'],
  ])('refuses the handle "%s" as %s', async (handle, reason) => {
    const res = await post('/api/signup/check', { handle });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'refused', reason });
  });
});

describe('POST /api/signup', () => {
  it('creates a player and answers 201 with the id and handle only', async () => {
    const res = await post('/api/signup', { handle: 'Zap', pin: '0420' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ player: { id: expect.any(Number), handle: 'Zap' }, followCode: FOLLOW_CODE });
    expect(Object.keys(res.json().player).sort()).toEqual(['handle', 'id']);
  });

  it('stores the handle as normalized and the PIN only as a hash', async () => {
    await signUp(' Zap  Man ', '0420');
    const row = db.prepare('SELECT handle, handle_key, pin_hash FROM players').get() as Record<string, string>;
    expect(row['handle']).toBe('Zap Man');
    expect(row['handle_key']).toBe('zap man');
    expect(row['pin_hash']).not.toContain('0420');
    expect(await verifyPin('0420', row['pin_hash'] as string)).toBe(true);
  });

  it('refuses a vulgar handle even though no client checked it', async () => {
    for (const handle of ['FUCK', 'Sh1t', 'A.S.S', 'Big Ass']) {
      const res = await post('/api/signup', { handle, pin: '1234' });
      expect(res.statusCode, handle).toBe(400);
      expect(res.json(), handle).toEqual({ error: 'refused', reason: 'not-allowed' });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 0 });
  });

  it('refuses the other bad handles with their reason', async () => {
    expect((await post('/api/signup', { handle: 'x', pin: '1234' })).json()).toEqual({ error: 'refused', reason: 'too-short' });
    expect((await post('/api/signup', { handle: '<b>', pin: '1234' })).json()).toEqual({
      error: 'refused',
      reason: 'bad-characters',
    });
  });

  it.each(['123', '12345', 'abcd', '12 4', '١٢٣٤', ''])('answers bad-pin for the PIN "%s"', async (pin) => {
    const res = await post('/api/signup', { handle: 'Zap', pin });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-pin' });
  });

  it('answers 409 taken for a handle that differs only in case or spaces', async () => {
    await signUp('Zap');
    for (const handle of ['Zap', 'ZAP', 'zap', ' zAp ']) {
      const res = await post('/api/signup', { handle, pin: '1234' });
      expect(res.statusCode, handle).toBe(409);
      expect(res.json(), handle).toEqual({ error: 'taken' });
    }
  });

  it('lets only one of two simultaneous sign-ups for the same handle in', async () => {
    const [a, b] = await Promise.all([
      post('/api/signup', { handle: 'Zap', pin: '1111' }),
      post('/api/signup', { handle: 'ZAP', pin: '2222' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 1 });
  });
});

describe('a taken handle asks for its PIN', () => {
  it('check says taken, then claim works with the right PIN and fails with a wrong one', async () => {
    const player = await signUp('Zap', '4321');

    const check = await post('/api/signup/check', { handle: 'zap' });
    expect(check.json().status).toBe('taken');

    const wrong = await post('/api/signup/claim', { handle: 'zap', pin: '1234' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'wrong-pin' });

    const right = await post('/api/signup/claim', { handle: 'zap', pin: '4321' });
    expect(right.statusCode).toBe(200);
    expect(right.json()).toEqual({ player, followCode: FOLLOW_CODE });
  });
});

describe('POST /api/signup/claim', () => {
  it('answers 404 for a handle nobody has', async () => {
    const res = await post('/api/signup/claim', { handle: 'Nobody', pin: '1234' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
  });

  it('refuses a vulgar handle before looking anything up', async () => {
    const res = await post('/api/signup/claim', { handle: 'FUCK', pin: '1234' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'refused', reason: 'not-allowed' });
  });

  it('answers wrong-pin for a PIN that is not 4 digits', async () => {
    await signUp('Zap');
    const res = await post('/api/signup/claim', { handle: 'Zap', pin: 'abcd' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'wrong-pin' });
  });

  it('is not limited offline: many wrong PINs still get an answer', async () => {
    await signUp('Zap', '4321');
    for (let i = 0; i < 12; i++) {
      expect((await post('/api/signup/claim', { handle: 'Zap', pin: '0000' })).statusCode).toBe(401);
    }
    expect((await post('/api/signup/claim', { handle: 'Zap', pin: '4321' })).statusCode).toBe(200);
  });
});

describe('body validation', () => {
  const cases: [string, string, unknown][] = [
    ['check without a handle', '/api/signup/check', {}],
    ['check with a number for the handle', '/api/signup/check', { handle: 12 }],
    ['check with an extra field', '/api/signup/check', { handle: 'Zap', admin: true }],
    ['signup without a PIN', '/api/signup', { handle: 'Zap' }],
    ['signup with the PIN as a number', '/api/signup', { handle: 'Zap', pin: 1234 }],
    ['claim with an extra field', '/api/signup/claim', { handle: 'Zap', pin: '1234', x: 1 }],
    ['host add without a handle', '/api/players', {}],
  ];
  it.each(cases)('answers bad-request for %s', async (_name, url, payload) => {
    const res = await post(url, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });

  it('answers bad-request for malformed JSON, without Fastify text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup/check',
      headers: { 'content-type': 'application/json' },
      payload: '{"handle": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });

  it('answers bad-request for a body that is plain text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup/check',
      headers: { 'content-type': 'text/plain' },
      payload: 'handle=Zap',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });

  it('answers a content type it cannot read with bad-request text-free JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signup/check',
      headers: { 'content-type': 'application/xml' },
      payload: '<handle>Zap</handle>',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });
});

describe('GET /api/players', () => {
  it('is empty at first', async () => {
    const res = await call('GET', '/api/players');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ players: [] });
  });

  it('lists players sorted by handle without regard to case, with id and handle only', async () => {
    const b = await signUp('bravo');
    const a = await signUp('Alpha');
    const c = await signUp('Charlie');
    const res = await call('GET', '/api/players');
    expect(res.json()).toEqual({ players: [a, b, c] });
  });
});

describe('POST /api/players', () => {
  it('adds a player and returns a PIN that then works for a claim', async () => {
    const res = await post('/api/players', { handle: 'Host Added' });
    expect(res.statusCode).toBe(201);
    const { player, pin } = res.json();
    expect(player).toEqual({ id: expect.any(Number), handle: 'Host Added' });
    expect(pin).toMatch(/^[0-9]{4}$/);
    expect(Object.keys(res.json()).sort()).toEqual(['pin', 'player']);

    const claim = await post('/api/signup/claim', { handle: 'host added', pin });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toEqual({ player, followCode: FOLLOW_CODE });
  });

  it('refuses a vulgar handle', async () => {
    const res = await post('/api/players', { handle: 'Sh1t' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'refused', reason: 'not-allowed' });
  });

  it('answers 409 for a taken handle', async () => {
    await signUp('Zap');
    const res = await post('/api/players', { handle: 'zap' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'taken' });
  });
});

describe('PATCH /api/players/:id', () => {
  it('renames a player', async () => {
    const { id } = await signUp('Zap');
    const res = await call('PATCH', `/api/players/${id}`, { handle: ' Zapper  One ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ player: { id, handle: 'Zapper One' } });
    expect((await call('GET', '/api/players')).json()).toEqual({ players: [{ id, handle: 'Zapper One' }] });
  });

  it('lets a player change only the case of their own handle', async () => {
    const { id } = await signUp('Zap');
    const res = await call('PATCH', `/api/players/${id}`, { handle: 'ZAP' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ player: { id, handle: 'ZAP' } });
  });

  it('answers 409 when another player has the handle', async () => {
    await signUp('Zap');
    const { id } = await signUp('Bolt');
    const res = await call('PATCH', `/api/players/${id}`, { handle: 'zAP' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'taken' });
  });

  it('refuses a vulgar new handle', async () => {
    const { id } = await signUp('Zap');
    const res = await call('PATCH', `/api/players/${id}`, { handle: 'FUCK' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'refused', reason: 'not-allowed' });
  });

  it('answers 404 for an unknown id', async () => {
    const res = await call('PATCH', '/api/players/999', { handle: 'Zap' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
  });

  it.each(['abc', '0', '-1', '1.5', '01'])('answers bad-request for the id "%s"', async (id) => {
    const res = await call('PATCH', `/api/players/${id}`, { handle: 'Zap' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });
});

describe('POST /api/players/:id/merge', () => {
  it('deletes the merged player and returns the kept one', async () => {
    const merged = await signUp('Zap');
    const kept = await signUp('Zapper');
    const res = await post(`/api/players/${merged.id}/merge`, { intoId: kept.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ player: kept });
    expect((await call('GET', '/api/players')).json()).toEqual({ players: [kept] });
    // The merged handle is free again.
    expect((await post('/api/signup/check', { handle: 'Zap' })).json().status).toBe('available');
  });

  it('answers 400 bad-request when merging a player into itself, and changes nothing', async () => {
    const { id } = await signUp('Zap');
    const res = await post(`/api/players/${id}/merge`, { intoId: id });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect((await call('GET', '/api/players')).json().players).toHaveLength(1);
  });

  it('answers 404 when either player is unknown, and changes nothing', async () => {
    const { id } = await signUp('Zap');
    for (const [from, into] of [
      [999, id],
      [id, 999],
    ] as const) {
      const res = await post(`/api/players/${from}/merge`, { intoId: into });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not-found' });
    }
    expect((await call('GET', '/api/players')).json().players).toHaveLength(1);
  });

  it('answers bad-request for a missing or non-integer intoId', async () => {
    const { id } = await signUp('Zap');
    for (const payload of [{}, { intoId: '2' }, { intoId: 1.5 }, { intoId: 0 }, { intoId: 2, extra: true }]) {
      const res = await post(`/api/players/${id}/merge`, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });
});

describe('POST /api/players/:id/reset-pin', () => {
  it('sets a new PIN, returns it once, and the old PIN stops working', async () => {
    const { id } = await signUp('Zap', '1111');
    const res = await post(`/api/players/${id}/reset-pin`);
    expect(res.statusCode).toBe(200);
    const { pin } = res.json();
    expect(Object.keys(res.json())).toEqual(['pin']);
    expect(pin).toMatch(/^[0-9]{4}$/);

    if (pin !== '1111') {
      expect((await post('/api/signup/claim', { handle: 'Zap', pin: '1111' })).statusCode).toBe(401);
    }
    expect((await post('/api/signup/claim', { handle: 'Zap', pin })).statusCode).toBe(200);
  });

  it('answers 404 for an unknown id', async () => {
    const res = await post('/api/players/999/reset-pin');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
  });
});

describe('what leaves the server (CLAUDE.md, rule 1)', () => {
  it('never includes a hash, a key, or a creation time in any answer', async () => {
    const a = await signUp('Zap', '1234');
    const b = await signUp('Bolt', '5678');
    await post('/api/signup/check', { handle: 'zap' });
    await post('/api/signup/check', { handle: 'fresh' });
    await post('/api/signup/claim', { handle: 'zap', pin: '1234' });
    await post('/api/signup/claim', { handle: 'zap', pin: '0000' });
    await call('GET', '/api/players');
    await post('/api/players', { handle: 'Added' });
    await call('PATCH', `/api/players/${a.id}`, { handle: 'Zapped' });
    await post(`/api/players/${b.id}/reset-pin`);
    await post(`/api/players/${a.id}/merge`, { intoId: b.id });
    await post('/api/signup', { handle: 'FUCK', pin: '1234' });

    expect(bodies.length).toBeGreaterThan(10);
    const all = bodies.join('\n');
    for (const leak of ['pin_hash', 'pinHash', 'handle_key', 'handleKey', 'created_at', 'createdAt', 'scrypt$']) {
      expect(all, leak).not.toContain(leak);
    }
  });

  it('lists only the documented keys in every successful answer', async () => {
    const player = await signUp('Zap');
    const keys = async (res: LightMyRequestResponse) => Object.keys(res.json()).sort();
    expect(await keys(await post('/api/signup/check', { handle: 'New' }))).toEqual(['handle', 'status', 'suggestedPin']);
    expect(await keys(await post('/api/signup/check', { handle: 'Zap' }))).toEqual(['handle', 'status']);
    expect(await keys(await post('/api/signup/claim', { handle: 'Zap', pin: '1234' }))).toEqual(['followCode', 'player']);
    expect(await keys(await call('GET', '/api/players'))).toEqual(['players']);
    expect(await keys(await call('PATCH', `/api/players/${player.id}`, { handle: 'Zap2' }))).toEqual(['player']);
  });
});
