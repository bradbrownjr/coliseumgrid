import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planDefaults } from '@coliseumgrid/core';
import {
  createEvent,
  getEvent,
  getPlan,
  getHostSession,
  getMyDevice,
  joinWithCode,
  listDevices,
  makePairingCode,
  saveEvent,
  savePlan,
  setUpHost,
  signInHost,
  signOutHost,
  unpairDevice,
} from '../src/api/host.ts';
import { onNotSignedIn } from '../src/api/request.ts';

const fetchMock = vi.fn<typeof fetch>();

function answer(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

function lastRequest() {
  const [path, init] = fetchMock.mock.calls.at(-1) ?? [];
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  return { path, method: init?.method, body, credentials: init?.credentials };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('host requests', () => {
  it('asks who the caller is with GET /api/host/session', async () => {
    answer(200, { signedIn: false, passwordSet: false, canSetUp: true });
    const result = await getHostSession();
    expect(lastRequest()).toMatchObject({ path: '/api/host/session', method: 'GET', body: undefined });
    expect(result).toEqual({ ok: true, data: { signedIn: false, passwordSet: false, canSetUp: true } });
  });

  it('sets the first password with POST /api/host/setup and reads the empty 204', async () => {
    answer(204);
    const result = await setUpHost('correct horse');
    expect(lastRequest()).toMatchObject({ path: '/api/host/setup', method: 'POST', body: { password: 'correct horse' } });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('signs in and out', async () => {
    answer(204);
    await signInHost('correct horse');
    expect(lastRequest()).toMatchObject({ path: '/api/host/sign-in', method: 'POST', body: { password: 'correct horse' } });
    answer(204);
    expect(await signOutHost()).toEqual({ ok: true, data: undefined });
    expect(lastRequest()).toMatchObject({ path: '/api/host/sign-out', method: 'POST', body: undefined });
  });

  it('makes a pairing code for a role', async () => {
    answer(201, { code: 'K7M4QX', role: 'display', expiresAt: '2026-07-10T18:10:00.000Z' });
    const result = await makePairingCode('display');
    expect(lastRequest()).toMatchObject({ path: '/api/pairing/codes', method: 'POST', body: { role: 'display' } });
    expect(result).toEqual({ ok: true, data: { code: 'K7M4QX', role: 'display', expiresAt: '2026-07-10T18:10:00.000Z' } });
  });

  it('joins with the code as typed', async () => {
    answer(201, { device: { id: 1, role: 'signup', label: 'Sign-up 1', lastSeen: '2026-07-10T18:00:00.000Z' } });
    await joinWithCode('k7m-4qx');
    expect(lastRequest()).toMatchObject({ path: '/api/devices/join', method: 'POST', body: { code: 'k7m-4qx' } });
  });

  it('reads this device, the device list, and the event', async () => {
    answer(200, { device: { id: 1, role: 'display', label: 'Display 1', lastSeen: 'x' } });
    await getMyDevice();
    expect(lastRequest()).toMatchObject({ path: '/api/devices/me', method: 'GET' });
    answer(200, { devices: [] });
    await listDevices();
    expect(lastRequest()).toMatchObject({ path: '/api/devices', method: 'GET' });
    answer(200, { event: null });
    expect(await getEvent()).toEqual({ ok: true, data: { event: null } });
    expect(lastRequest()).toMatchObject({ path: '/api/event', method: 'GET' });
  });

  it('unpairs with DELETE /api/devices/:id', async () => {
    answer(204);
    await unpairDevice(7);
    expect(lastRequest()).toMatchObject({ path: '/api/devices/7', method: 'DELETE', body: undefined });
  });

  it('names the event with PUT /api/event, leaving the game out unless it is given', async () => {
    answer(200, { event: { name: 'Spring Bash', game: null } });
    await saveEvent('Spring Bash');
    expect(lastRequest()).toMatchObject({ path: '/api/event', method: 'PUT' });
    expect(lastRequest().body).toEqual({ name: 'Spring Bash' });
    answer(200, { event: { name: 'Spring Bash', game: null } });
    await saveEvent('Spring Bash', '');
    expect(lastRequest().body).toEqual({ name: 'Spring Bash', game: '' });
    answer(200, { event: { name: 'Spring Bash', game: 'Racing game' } });
    await saveEvent('Spring Bash', 'Racing game');
    expect(lastRequest().body).toEqual({ name: 'Spring Bash', game: 'Racing game' });
  });

  it('makes a new event with POST /api/events, with no game when none was typed', async () => {
    answer(201, { event: { name: 'Round two', game: null } });
    const result = await createEvent('Round two', '');
    expect(lastRequest()).toMatchObject({ path: '/api/events', method: 'POST' });
    expect(lastRequest().body).toEqual({ name: 'Round two' });
    expect(result).toEqual({ ok: true, data: { event: { name: 'Round two', game: null } } });
    answer(201, { event: { name: 'Round two', game: 'Racing game' } });
    await createEvent('Round two', 'Racing game');
    expect(lastRequest().body).toEqual({ name: 'Round two', game: 'Racing game' });
    answer(409, { error: 'bracket-running' });
    expect(await createEvent('Round two', '')).toEqual({ ok: false, error: 'bracket-running' });
  });

  it('reads and saves the plan with GET and PUT /api/event/plan', async () => {
    answer(200, { plan: null });
    expect(await getPlan()).toEqual({ ok: true, data: { plan: null } });
    expect(lastRequest()).toMatchObject({ path: '/api/event/plan', method: 'GET', body: undefined });
    const plan = planDefaults('racing');
    answer(200, { plan });
    await savePlan(plan);
    expect(lastRequest()).toMatchObject({ path: '/api/event/plan', method: 'PUT', body: { plan } });
  });

  it('sends cookies on every request', async () => {
    answer(200, { event: null });
    await getEvent();
    expect(lastRequest().credentials).toBe('same-origin');
  });
});

describe('host errors', () => {
  it('maps the codes the host routes answer with', async () => {
    const cases: Array<[number, string]> = [
      [401, 'wrong-password'],
      [429, 'too-many-tries'],
      [403, 'forbidden'],
      [404, 'wrong-code'],
      [401, 'not-paired'],
    ];
    for (const [status, error] of cases) {
      answer(status, { error });
      expect(await signInHost('x')).toEqual({ ok: false, error });
    }
  });

  it('treats a code it does not know, a dead network, and a bad body as a failed call', async () => {
    answer(500, { error: 'surprise' });
    expect(await getEvent()).toEqual({ ok: false, error: 'failed' });
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    expect(await getEvent()).toEqual({ ok: false, error: 'failed' });
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await getEvent()).toEqual({ ok: false, error: 'failed' });
  });

  it('tells listeners when any call is answered not-signed-in, and stops when asked', async () => {
    const heard = vi.fn();
    const stop = onNotSignedIn(heard);
    answer(401, { error: 'not-signed-in' });
    expect(await listDevices()).toEqual({ ok: false, error: 'not-signed-in' });
    expect(heard).toHaveBeenCalledTimes(1);
    answer(401, { error: 'wrong-password' });
    await signInHost('x');
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    answer(401, { error: 'not-signed-in' });
    await listDevices();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
