import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markArrived, recordResult } from '../src/api/bracket.ts';
import { resetServerClock, serverNow } from '../src/api/clock.ts';
import { markHeatArrived, recordHeat } from '../src/api/heats.ts';

const fetchMock = vi.fn<typeof fetch>();

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

function lastRequest() {
  const [path, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { path, method: init?.method, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetServerClock();
});

describe('recording a bracket result', () => {
  it('sends only the match and the winner for an ordinary result', async () => {
    answer(200, { bracket: null, resultId: 4 });
    await recordResult(12, 3);
    expect(lastRequest()).toEqual({ path: '/api/bracket/results', method: 'POST', body: { matchId: 12, winnerId: 3 } });
  });

  it('adds forfeit: true when the other player did not come', async () => {
    answer(200, { bracket: null, resultId: 5 });
    await recordResult(12, 3, true);
    expect(lastRequest().body).toEqual({ matchId: 12, winnerId: 3, forfeit: true });
  });
});

describe('recording a group result', () => {
  it('sends only the order when everyone came', async () => {
    answer(200, { heats: null, resultId: 7 });
    await recordHeat(101, [3, 1, 2]);
    expect(lastRequest()).toEqual({ path: '/api/heats/results', method: 'POST', body: { heatId: 101, order: [3, 1, 2] } });
    answer(200, { heats: null, resultId: 8 });
    await recordHeat(101, [3, 1, 2], []);
    expect(lastRequest().body).toEqual({ heatId: 101, order: [3, 1, 2] });
  });

  it('sends the missing players with the order of the rest', async () => {
    answer(200, { heats: null, resultId: 9 });
    await recordHeat(101, [2], [1, 3]);
    expect(lastRequest().body).toEqual({ heatId: 101, order: [2], missing: [1, 3] });
  });
});

describe("They're here", () => {
  it('sends the match and true, and with Undo the match and false', async () => {
    answer(200, { bracket: null, now: '2026-11-15T10:00:00.000Z' });
    await markArrived(12);
    expect(lastRequest()).toEqual({ path: '/api/bracket/arrived', method: 'POST', body: { matchId: 12, arrived: true } });
    answer(200, { bracket: null, now: '2026-11-15T10:00:00.000Z' });
    await markArrived(12, false);
    expect(lastRequest().body).toEqual({ matchId: 12, arrived: false });
  });

  it('does the same for a group', async () => {
    answer(200, { heats: null, now: '2026-11-15T10:00:00.000Z' });
    await markHeatArrived(101);
    expect(lastRequest()).toEqual({ path: '/api/heats/arrived', method: 'POST', body: { heatId: 101, arrived: true } });
    answer(200, { heats: null, now: '2026-11-15T10:00:00.000Z' });
    await markHeatArrived(101, false);
    expect(lastRequest().body).toEqual({ heatId: 101, arrived: false });
  });
});

describe('the server clock from the answers', () => {
  it('is learned from an answer that carries now, and not changed by one that fails', async () => {
    expect(serverNow(1_000_000)).toBe(1_000_000);
    // The answer says the server is 90 seconds ahead of the middle of the request.
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValueOnce(10_000).mockReturnValueOnce(10_000);
    answer(200, { bracket: null, resultId: 1, now: new Date(10_000 + 90_000).toISOString() });
    await recordResult(1, 2);
    spy.mockRestore();
    expect(serverNow(1_000_000)).toBe(1_090_000);
    answer(500, { error: 'server-error' });
    await recordResult(1, 2);
    expect(serverNow(1_000_000)).toBe(1_090_000);
  });
});
