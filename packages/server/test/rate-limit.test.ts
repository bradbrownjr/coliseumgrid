import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
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

async function start(mode: Mode, trustedProxy?: string): Promise<FastifyInstance> {
  app = await buildApp({ mode, ...(trustedProxy && { trustedProxy }) });
  return app;
}

function claim(server: FastifyInstance, handle: string, pin: string, remoteAddress = '198.51.100.7', headers = {}) {
  return server.inject({ method: 'POST', url: '/api/signup/claim', payload: { handle, pin }, remoteAddress, headers });
}

async function signUp(server: FastifyInstance, handle: string, pin = '4321') {
  const res = await server.inject({ method: 'POST', url: '/api/signup', payload: { handle, pin } });
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

  it('keeps the other routes open', async () => {
    const server = await start('online');
    await signUp(server, 'Zap');
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) await claim(server, 'Zap', '0000');
    const check = await server.inject({ method: 'POST', url: '/api/signup/check', payload: { handle: 'Zap' } });
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

  it('only limits the claim route', async () => {
    const server = await start('online');
    for (let i = 0; i < CLAIM_MAX_PER_IP + 5; i++) {
      const res = await server.inject({ method: 'GET', url: '/api/players', remoteAddress: '198.51.100.7' });
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
  it('blocks at the maximum and forgets a key when its window ends', () => {
    let now = 1_000;
    const limiter = new FailureLimiter(3, CLAIM_WINDOW_MS, () => now);
    limiter.recordFailure('zap');
    limiter.recordFailure('zap');
    expect(limiter.isBlocked('zap')).toBe(false);
    limiter.recordFailure('zap');
    expect(limiter.isBlocked('zap')).toBe(true);
    expect(limiter.isBlocked('bolt')).toBe(false);

    now += CLAIM_WINDOW_MS - 1;
    expect(limiter.isBlocked('zap')).toBe(true);
    now += 1;
    expect(limiter.isBlocked('zap')).toBe(false);

    // A fresh window starts counting from one.
    limiter.recordFailure('zap');
    expect(limiter.isBlocked('zap')).toBe(false);
  });
});
