import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { HOST_PASSWORD, signInHost } from './helpers.ts';
import type { Mode } from '../src/config.ts';
import {
  CLAIM_MAX_PER_IP,
  CLAIM_MAX_WRONG_PER_HANDLE,
  CLAIM_WINDOW_MS,
  FailureLimiter,
} from '../src/rate-limit.ts';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

// The claim route needs a host or Sign-up session, so the host signs in once per app and every
// request carries that cookie. The tests below vary the remote address, which a cookie ignores.
let cookie = '';

async function start(mode: Mode, trustedProxy?: string): Promise<FastifyInstance> {
  app = await buildApp({ mode, hostPassword: HOST_PASSWORD, ...(trustedProxy && { trustedProxy }) });
  cookie = await signInHost(app, '127.0.0.1');
  return app;
}

/** inject() with the host's cookie. */
function send(server: FastifyInstance, options: InjectOptions) {
  return server.inject({ ...options, headers: { cookie, ...options.headers } });
}

function claim(server: FastifyInstance, handle: string, pin: string, remoteAddress = '198.51.100.7', headers = {}) {
  return send(server, { method: 'POST', url: '/api/signup/claim', payload: { handle, pin }, remoteAddress, headers });
}

async function signUp(server: FastifyInstance, handle: string, pin = '4321') {
  const res = await send(server, { method: 'POST', url: '/api/signup', payload: { handle, pin } });
  expect(res.statusCode).toBe(201);
}

describe('the per-handle limit (online)', () => {
  it('blocks the handle after too many wrong PINs, even for the right PIN, and answers too-many-tries', async () => {
    const server = await start('online');
    await signUp(server, 'Zap');
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) {
      // Different client addresses, so only the handle limit can be what stops this.
      const res = await claim(server, 'Zap', '0000', `198.51.100.${10 + i}`);
      expect(res.statusCode).toBe(401);
    }
    for (const pin of ['0000', '4321']) {
      const res = await claim(server, 'zap', pin, '198.51.100.99');
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'too-many-tries' });
    }
  });

  it('does not count right PINs, and does not touch other handles', async () => {
    const server = await start('online');
    await signUp(server, 'Zap');
    await signUp(server, 'Bolt');
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE + 3; i++) {
      expect((await claim(server, 'Zap', '4321')).statusCode).toBe(200);
    }
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) await claim(server, 'Bolt', '0000');
    expect((await claim(server, 'Bolt', '4321')).statusCode).toBe(429);
    expect((await claim(server, 'Zap', '4321')).statusCode).toBe(200);
  });

  it('lets a few mistakes through before it blocks', async () => {
    const server = await start('online');
    await signUp(server, 'Zap');
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE - 1; i++) await claim(server, 'Zap', '0000');
    expect((await claim(server, 'Zap', '4321')).statusCode).toBe(200);
  });

  it('lets at most the limit through when wrong claims arrive at the same time', async () => {
    const server = await start('online');
    await signUp(server, 'Zap');
    const results = await Promise.all(
      Array.from({ length: 40 }, (_unused, i) => claim(server, 'Zap', '0000', `198.51.100.${i + 1}`)),
    );
    const codes = results.map((res) => res.statusCode);
    expect(codes.filter((code) => code === 401).length).toBeLessThanOrEqual(CLAIM_MAX_WRONG_PER_HANDLE);
    expect(codes.filter((code) => code === 429).length).toBe(40 - codes.filter((code) => code === 401).length);
  });

  it('resets the count on a right PIN, so earlier mistypes do not carry over', async () => {
    const server = await start('online');
    await signUp(server, 'Zap');
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE - 1; i++) {
        expect((await claim(server, 'Zap', '0000')).statusCode).toBe(401);
      }
      expect((await claim(server, 'Zap', '4321')).statusCode).toBe(200);
    }
  });

  it('lets a locked player in at once after the host resets the PIN', async () => {
    const server = await start('online');
    const id = (await send(server, { method: 'POST', url: '/api/signup', payload: { handle: 'Zap', pin: '4321' } })).json().player.id;
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) await claim(server, 'Zap', '0000');
    expect((await claim(server, 'Zap', '4321')).statusCode).toBe(429);
    const { pin } = (await send(server, { method: 'POST', url: `/api/players/${id}/reset-pin` })).json();
    expect((await claim(server, 'Zap', pin)).statusCode).toBe(200);
  });

  it('does not leave a count on a handle after a rename or a merge', async () => {
    const server = await start('online');
    const post = (url: string, payload?: object) => send(server, { method: 'POST', url, ...(payload && { payload }) });
    const zap = (await post('/api/signup', { handle: 'Zap', pin: '4321' })).json().player;
    const bolt = (await post('/api/signup', { handle: 'Bolt', pin: '4321' })).json().player;
    for (const handle of ['Zap', 'Bolt']) {
      for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) await claim(server, handle, '0000');
    }
    await send(server, { method: 'PATCH', url: `/api/players/${zap.id}`, payload: { handle: 'Zapper' } });
    await post(`/api/players/${bolt.id}/merge`, { intoId: zap.id });
    // A new player takes each freed handle and is not locked by the old player's tries.
    await post('/api/signup', { handle: 'Zap', pin: '1111' });
    await post('/api/signup', { handle: 'Bolt', pin: '2222' });
    expect((await claim(server, 'Zap', '1111')).statusCode).toBe(200);
    expect((await claim(server, 'Bolt', '2222')).statusCode).toBe(200);
  });

  it('keeps the other routes open', async () => {
    const server = await start('online');
    await signUp(server, 'Zap');
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) await claim(server, 'Zap', '0000');
    const check = await send(server, { method: 'POST', url: '/api/signup/check', payload: { handle: 'Zap' } });
    expect(check.statusCode).toBe(200);
  });
});

describe('the per-IP limit (online)', () => {
  it('stops one address after its claims, whatever the handle', async () => {
    const server = await start('online');
    for (let i = 0; i < CLAIM_MAX_PER_IP; i++) {
      expect((await claim(server, `Nobody ${i}`, '1234')).statusCode).toBe(404);
    }
    const res = await claim(server, 'Nobody Else', '1234');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'too-many-tries' });
    // Another address is unaffected.
    expect((await claim(server, 'Nobody Else', '1234', '198.51.100.8')).statusCode).toBe(404);
  });

  it('counts an IPv6 address by its /64, so rotating inside one range gets no fresh claims', async () => {
    const server = await start('online');
    for (let i = 0; i < CLAIM_MAX_PER_IP; i++) await claim(server, 'Nobody', '1234', `2001:db8:1:2::${i + 1}`);
    expect((await claim(server, 'Nobody', '1234', '2001:db8:1:2:aaaa:bbbb:cccc:dddd')).statusCode).toBe(429);
    expect((await claim(server, 'Nobody', '1234', '2001:db8:1:3::1')).statusCode).toBe(404);
  });

  it('only limits the claim route', async () => {
    const server = await start('online');
    for (let i = 0; i < CLAIM_MAX_PER_IP + 5; i++) {
      const res = await send(server, { method: 'GET', url: '/api/players', remoteAddress: '198.51.100.7' });
      expect(res.statusCode).toBe(200);
    }
  });

  it('ignores X-Forwarded-For from a peer that is not the trusted proxy', async () => {
    const server = await start('online', '10.0.0.1');
    for (let i = 0; i < CLAIM_MAX_PER_IP; i++) {
      // A new made-up address every time would reset the count if the header were believed.
      await claim(server, 'Nobody', '1234', '198.51.100.7', { 'x-forwarded-for': `203.0.113.${i}` });
    }
    const res = await claim(server, 'Nobody', '1234', '198.51.100.7', { 'x-forwarded-for': '203.0.113.200' });
    expect(res.statusCode).toBe(429);
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    const server = await start('online');
    for (let i = 0; i < CLAIM_MAX_PER_IP; i++) {
      await claim(server, 'Nobody', '1234', '10.0.0.1', { 'x-forwarded-for': `203.0.113.${i}` });
    }
    const res = await claim(server, 'Nobody', '1234', '10.0.0.1', { 'x-forwarded-for': '203.0.113.200' });
    expect(res.statusCode).toBe(429);
  });

  it('keys on the LAST entry from the trusted proxy, so a made-up first entry does not help', async () => {
    const server = await start('online', '10.0.0.1');
    for (let i = 0; i < CLAIM_MAX_PER_IP; i++) {
      await claim(server, 'Nobody', '1234', '10.0.0.1', { 'x-forwarded-for': `203.0.113.${i}, 192.0.2.50` });
    }
    const blocked = await claim(server, 'Nobody', '1234', '10.0.0.1', { 'x-forwarded-for': '203.0.113.250, 192.0.2.50' });
    expect(blocked.statusCode).toBe(429);
    // A different last entry is a different client.
    const other = await claim(server, 'Nobody', '1234', '10.0.0.1', { 'x-forwarded-for': '203.0.113.250, 192.0.2.51' });
    expect(other.statusCode).toBe(404);
  });
});

describe('offline mode', () => {
  it('has no per-IP limit', async () => {
    const server = await start('offline');
    for (let i = 0; i < CLAIM_MAX_PER_IP + 10; i++) {
      expect((await claim(server, `Nobody ${i}`, '1234')).statusCode).toBe(404);
    }
  });

  it('has no per-handle limit', async () => {
    const server = await start('offline');
    await signUp(server, 'Zap');
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE + 5; i++) {
      expect((await claim(server, 'Zap', '0000')).statusCode).toBe(401);
    }
    expect((await claim(server, 'Zap', '4321')).statusCode).toBe(200);
  });

  it('sends no rate-limit headers', async () => {
    const server = await start('offline');
    const res = await claim(server, 'Nobody', '1234');
    expect(Object.keys(res.headers).filter((h) => h.startsWith('x-ratelimit'))).toEqual([]);
  });
});

describe('FailureLimiter', () => {
  it('counts each attempt up front, blocks at the maximum, and forgets a key when its window ends', () => {
    let now = 1_000;
    const limiter = new FailureLimiter(3, CLAIM_WINDOW_MS, () => now);
    expect(limiter.tryAttempt('zap')).toBe(true);
    expect(limiter.tryAttempt('zap')).toBe(true);
    expect(limiter.tryAttempt('zap')).toBe(true);
    expect(limiter.tryAttempt('zap')).toBe(false);
    expect(limiter.tryAttempt('bolt')).toBe(true);

    now += CLAIM_WINDOW_MS - 1;
    expect(limiter.tryAttempt('zap')).toBe(false);
    now += 1;
    expect(limiter.tryAttempt('zap')).toBe(true);
  });

  it('clear forgets the count', () => {
    const limiter = new FailureLimiter(1, CLAIM_WINDOW_MS);
    expect(limiter.tryAttempt('zap')).toBe(true);
    expect(limiter.tryAttempt('zap')).toBe(false);
    limiter.clear('zap');
    expect(limiter.tryAttempt('zap')).toBe(true);
  });

  it('handles many distinct keys in bounded time', () => {
    // Every new key used to sweep the whole map, so 40,000 keys took about 17 seconds.
    const limiter = new FailureLimiter(1, CLAIM_WINDOW_MS, () => 1_000, 100_000);
    const started = performance.now();
    for (let i = 0; i < 40_000; i++) expect(limiter.tryAttempt(`key-${i}`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('blocks new keys while the map is full of live ones, and still counts the keys it holds', () => {
    let now = 1_000;
    const limiter = new FailureLimiter(2, CLAIM_WINDOW_MS, () => now, 3);
    for (const key of ['a', 'b', 'c']) expect(limiter.tryAttempt(key)).toBe(true);
    expect(limiter.tryAttempt('d')).toBe(false);
    // A key already held keeps its own count.
    expect(limiter.tryAttempt('a')).toBe(true);
    expect(limiter.tryAttempt('a')).toBe(false);
    // Clearing a key frees a place.
    limiter.clear('b');
    expect(limiter.tryAttempt('d')).toBe(true);
    expect(limiter.tryAttempt('e')).toBe(false);
  });

  it('makes room again when the held keys expire, oldest first, including a reused key', () => {
    let now = 1_000;
    const limiter = new FailureLimiter(1, CLAIM_WINDOW_MS, () => now, 2);
    expect(limiter.tryAttempt('a')).toBe(true);
    now += 10;
    expect(limiter.tryAttempt('b')).toBe(true);
    expect(limiter.tryAttempt('c')).toBe(false);

    // Only a has expired. Reusing it must not leave b's older expiry hidden behind it.
    now = 1_000 + CLAIM_WINDOW_MS;
    expect(limiter.tryAttempt('a')).toBe(true);
    expect(limiter.tryAttempt('c')).toBe(false);
    now = 1_010 + CLAIM_WINDOW_MS;
    expect(limiter.tryAttempt('c')).toBe(true);
    expect(limiter.tryAttempt('a')).toBe(false);
  });

  it('refund gives one attempt back and never goes below zero', () => {
    const limiter = new FailureLimiter(1, CLAIM_WINDOW_MS);
    expect(limiter.tryAttempt('x')).toBe(true);
    expect(limiter.tryAttempt('x')).toBe(false);
    limiter.refund('x');
    expect(limiter.tryAttempt('x')).toBe(true);
    limiter.refund('x');
    limiter.refund('x');
    limiter.refund('unknown');
    expect(limiter.tryAttempt('x')).toBe(true);
    expect(limiter.tryAttempt('x')).toBe(false);
  });
});
