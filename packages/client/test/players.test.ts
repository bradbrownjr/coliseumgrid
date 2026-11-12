import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPlayer,
  checkSignup,
  claimHandle,
  listPlayers,
  mergePlayer,
  renamePlayer,
  resetPin,
  signUp,
} from '../src/api/players.ts';

const fetchMock = vi.fn<typeof fetch>();

function answer(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

/** The request the last call made, with its JSON body parsed. */
function lastRequest() {
  const [path, init] = fetchMock.mock.calls.at(-1) ?? [];
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  return { path, method: init?.method, body, headers: init?.headers };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('requests', () => {
  it('checks a handle with POST /api/signup/check', async () => {
    answer(200, { status: 'available', handle: 'Zap', suggestedPin: '4821' });
    const result = await checkSignup('Zap');
    expect(lastRequest()).toMatchObject({
      path: '/api/signup/check',
      method: 'POST',
      body: { handle: 'Zap' },
      headers: { 'content-type': 'application/json' },
    });
    expect(result).toEqual({ ok: true, data: { status: 'available', handle: 'Zap', suggestedPin: '4821' } });
  });

  it('signs up with POST /api/signup', async () => {
    answer(201, { player: { id: 1, handle: 'Zap' } });
    await signUp('Zap', '4821');
    expect(lastRequest()).toMatchObject({ path: '/api/signup', method: 'POST', body: { handle: 'Zap', pin: '4821' } });
  });

  it('claims with POST /api/signup/claim', async () => {
    answer(200, { player: { id: 1, handle: 'Zap' } });
    await claimHandle('Zap', '0042');
    expect(lastRequest()).toMatchObject({ path: '/api/signup/claim', method: 'POST', body: { handle: 'Zap', pin: '0042' } });
  });

  it('lists players with a GET that has no body', async () => {
    answer(200, { players: [{ id: 1, handle: 'Zap' }] });
    const result = await listPlayers();
    expect(lastRequest()).toMatchObject({ path: '/api/players', method: 'GET', body: undefined, headers: undefined });
    expect(result).toEqual({ ok: true, data: { players: [{ id: 1, handle: 'Zap' }] } });
  });

  it('adds a player with POST /api/players', async () => {
    answer(201, { player: { id: 2, handle: 'Max' }, pin: '1234' });
    await addPlayer('Max');
    expect(lastRequest()).toMatchObject({ path: '/api/players', method: 'POST', body: { handle: 'Max' } });
  });

  it('renames with PATCH /api/players/:id', async () => {
    answer(200, { player: { id: 2, handle: 'Maxx' } });
    await renamePlayer(2, 'Maxx');
    expect(lastRequest()).toMatchObject({ path: '/api/players/2', method: 'PATCH', body: { handle: 'Maxx' } });
  });

  it('merges with POST /api/players/:id/merge and the id to keep', async () => {
    answer(200, { player: { id: 3, handle: 'Kai' } });
    await mergePlayer(2, 3);
    expect(lastRequest()).toMatchObject({ path: '/api/players/2/merge', method: 'POST', body: { intoId: 3 } });
  });

  it('resets a PIN with POST /api/players/:id/reset-pin and no body', async () => {
    answer(200, { pin: '9090' });
    const result = await resetPin(2);
    expect(lastRequest()).toMatchObject({ path: '/api/players/2/reset-pin', method: 'POST', body: undefined });
    expect(result).toEqual({ ok: true, data: { pin: '9090' } });
  });

  it('uses relative paths only', async () => {
    answer(200, { players: [] });
    await listPlayers();
    expect(String(lastRequest().path)).toMatch(/^\/api\//);
  });
});

describe('answers', () => {
  it('maps an error code to a failure', async () => {
    answer(409, { error: 'taken' });
    expect(await signUp('Zap', '1234')).toEqual({ ok: false, error: 'taken' });
  });

  it('keeps the reason of a refused handle', async () => {
    answer(400, { error: 'refused', reason: 'too-short' });
    expect(await checkSignup('Z')).toEqual({ ok: false, error: 'refused', reason: 'too-short' });
  });

  it.each([
    [401, 'wrong-pin'],
    [404, 'not-found'],
    [429, 'too-many-tries'],
    [400, 'bad-pin'],
    [400, 'bad-request'],
  ])('maps %i %s', async (status, error) => {
    answer(status, { error });
    expect(await claimHandle('Zap', '1234')).toEqual({ ok: false, error });
  });

  it('drops a reason it does not know', async () => {
    answer(400, { error: 'refused', reason: 'made-up' });
    expect(await checkSignup('Zap')).toEqual({ ok: false, error: 'refused' });
  });

  it('turns an unknown error code into failed', async () => {
    answer(500, { error: 'made-up' });
    expect(await listPlayers()).toEqual({ ok: false, error: 'failed' });
  });

  it('turns an answer that is not JSON into failed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await listPlayers()).toEqual({ ok: false, error: 'failed' });
  });

  it('turns a network error into failed', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await listPlayers()).toEqual({ ok: false, error: 'failed' });
  });
});
