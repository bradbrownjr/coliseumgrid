import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  followPlayer,
  followWithCode,
  getPhone,
  getPushKey,
  removePushSubscription,
  savePushSubscription,
  signOutPhone,
  stopFollowing,
} from '../src/api/phone.ts';

const fetchMock = vi.fn<typeof fetch>();

function answer(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    body === undefined ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

function lastRequest() {
  const [path, init] = fetchMock.mock.calls.at(-1) ?? [];
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  return { path, method: init?.method, body };
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('phone calls', () => {
  it('follows by handle and PIN', async () => {
    answer(201, { following: [{ id: 3, handle: 'Zap' }] });
    expect(await followPlayer('Zap', '4821')).toEqual({ ok: true, data: { following: [{ id: 3, handle: 'Zap' }] } });
    expect(lastRequest()).toEqual({ path: '/api/phone/follow', method: 'POST', body: { handle: 'Zap', pin: '4821' } });
  });

  it('follows by code', async () => {
    answer(201, { following: [] });
    await followWithCode('K7M-4QX');
    expect(lastRequest()).toEqual({ path: '/api/phone/follow-code', method: 'POST', body: { code: 'K7M-4QX' } });
  });

  it('reads the one phone answer', async () => {
    answer(200, { event: null, following: [], standings: null });
    expect((await getPhone()).ok).toBe(true);
    expect(lastRequest()).toMatchObject({ path: '/api/phone', method: 'GET' });
  });

  it('stops following one player, and signs out', async () => {
    answer(200, { following: [] });
    await stopFollowing(3);
    expect(lastRequest()).toMatchObject({ path: '/api/phone/follow/3', method: 'DELETE' });
    answer(204);
    expect(await signOutPhone()).toEqual({ ok: true, data: undefined });
    expect(lastRequest()).toMatchObject({ path: '/api/phone/sign-out', method: 'POST' });
  });

  it('asks for the push key, and saves and removes a subscription', async () => {
    answer(200, { publicKey: null });
    expect(await getPushKey()).toEqual({ ok: true, data: { publicKey: null } });
    answer(204);
    await savePushSubscription({ endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } });
    expect(lastRequest()).toEqual({ path: '/api/phone/push', method: 'PUT', body: { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } } });
    answer(204);
    await removePushSubscription();
    expect(lastRequest()).toMatchObject({ path: '/api/phone/push', method: 'DELETE' });
  });

  it('passes the error codes on', async () => {
    answer(401, { error: 'wrong-pin' });
    expect(await followPlayer('Zap', '0000')).toEqual({ ok: false, error: 'wrong-pin' });
    answer(409, { error: 'too-many-handles' });
    expect(await followPlayer('Zap', '0000')).toEqual({ ok: false, error: 'too-many-handles' });
    answer(401, { error: 'not-following' });
    expect(await getPhone()).toEqual({ ok: false, error: 'not-following' });
  });
});
