// Whole events played through the routes: create, results to a finish, undo, a late join, and a
// tie-break in a round robin (docs/PLAN.md, "Brackets API"). The engine's rules are tested at
// every size in the bracket-*.test.ts files; this checks the routes carry them whole.

import type { Bracket, BracketMatch } from '@coliseumgrid/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { addPlayers, expectContractShape, makeCallers, onStations, type Api } from './bracket-api-helpers.ts';

let app: FastifyInstance;
let db: Database;
let host: Api;
let ids: number[];

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db });
  ({ host } = await makeCallers(app));
  ids = addPlayers(db, 8);
});
afterEach(() => app.close());

const get = async (): Promise<Bracket> => (await host('GET', '/api/bracket')).json().bracket;

async function record(match: BracketMatch, winnerId: number) {
  const res = await host('POST', '/api/bracket/results', { matchId: match.id, winnerId });
  expect(res.statusCode, res.body).toBe(200);
  expectContractShape(res.json().bracket);
  return res.json() as { bracket: Bracket; resultId: number };
}

/**
 * Plays until nothing is left to play, starting a tie-break whenever the bracket asks.
 * `winner` picks the player to win a match.
 */
async function playToTheEnd(winner: (match: BracketMatch) => number, limit = 200): Promise<Bracket> {
  let bracket = await get();
  for (let i = 0; i < limit; i++) {
    const match = onStations(bracket)[0];
    if (match) {
      bracket = (await record(match, winner(match))).bracket;
    } else if (bracket.ties.some((t) => !t.started)) {
      const res = await host('POST', '/api/bracket/tie-break');
      expect(res.statusCode, res.body).toBe(200);
      bracket = res.json().bracket;
    } else {
      return bracket;
    }
  }
  throw new Error('the bracket never finished');
}

const playerIds = (match: BracketMatch): number[] => match.slots.map((s) => s.player?.id as number);

describe('a round robin through the routes', () => {
  it('takes a late player, an undo, a three-way tie, and its tie-break, then finishes with unique top places', async () => {
    const [p1, p2, p3] = ids as [number, number, number];
    const created = await host('POST', '/api/bracket', { format: 'round_robin', bestOf: 3, stations: 2, playerIds: ids.slice(0, 5) });
    expect(created.statusCode).toBe(201);
    let bracket = created.json().bracket as Bracket;
    expect(bracket.lateOpen).toBe(true);

    // The sixth player takes the empty slot before any result.
    const late = await host('POST', '/api/bracket/players', { playerId: ids[5] });
    expect(late.statusCode, late.body).toBe(200);
    bracket = late.json().bracket;
    expect(bracket.lateOpen).toBe(false);
    expect(bracket.standings).toHaveLength(6);
    expect((await host('POST', '/api/bracket/players', { playerId: ids[6] })).json()).toEqual({ error: 'late-closed' });
    expect((await host('POST', '/api/bracket/players', { playerId: ids[5] })).json()).toEqual({ error: 'already-in' });

    // Players 1, 2 and 3 beat everyone else and each other in a ring, so all three win the
    // same number of matches. Everyone else: the lower id wins. A tie-break match: the lower id.
    const ring = (a: number, b: number): number => {
      if ((a === p1 && b === p2) || (a === p2 && b === p1)) return p1;
      if ((a === p2 && b === p3) || (a === p3 && b === p2)) return p2;
      if ((a === p3 && b === p1) || (a === p1 && b === p3)) return p3;
      return -1;
    };
    const top = new Set([p1, p2, p3]);
    const winner = (match: BracketMatch): number => {
      const [a, b] = playerIds(match) as [number, number];
      if (match.side === 'tie-break') return Math.min(a, b);
      if (top.has(a) && top.has(b)) return ring(a, b);
      if (top.has(a) !== top.has(b)) return top.has(a) ? a : b;
      return Math.min(a, b);
    };

    // Two results, and the second undone: the bracket is exactly what it was after the first.
    // (The first follows the plan above so the tie still comes; the second is taken back.)
    const first = await record(onStations(bracket)[0] as BracketMatch, winner(onStations(bracket)[0] as BracketMatch));
    const afterFirst = first.bracket;
    const second = await record(onStations(afterFirst)[0] as BracketMatch, playerIds(onStations(afterFirst)[0] as BracketMatch)[1] as number);
    const undone = await host('POST', '/api/bracket/undo', { resultId: second.resultId });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().bracket).toEqual(afterFirst);
    expect(await get()).toEqual(afterFirst);

    // Play the 15 matches. Nothing is left on a station, but the tie is not settled.
    let guard = 0;
    while (onStations(bracket = await get()).length > 0 && guard++ < 40) {
      await record(onStations(bracket)[0] as BracketMatch, winner(onStations(bracket)[0] as BracketMatch));
    }
    bracket = await get();
    expect(bracket.finished).toBe(false);
    expect(bracket.ties).toEqual([
      { place: 1, players: expect.arrayContaining([{ id: p1, handle: 'Player1' }, { id: p2, handle: 'Player2' }, { id: p3, handle: 'Player3' }]), started: false },
    ]);
    expect(bracket.matches.some((m) => m.side === 'tie-break')).toBe(false);

    // "Play tie-break" makes its matches; asking again has nothing to make.
    const made = await host('POST', '/api/bracket/tie-break');
    expect(made.statusCode).toBe(200);
    expectContractShape(made.json().bracket);
    expect(made.json().bracket.ties[0].started).toBe(true);
    expect(made.json().bracket.matches.filter((m: BracketMatch) => m.side === 'tie-break').length).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_tie_breaks').get()).not.toEqual({ n: 0 });
    const again = await host('POST', '/api/bracket/tie-break');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'no-tie' });

    // A result from before the tie-break can't come off while the tie-break was made from it.
    const oldest = (await get()).matches.find((m) => m.resultId !== null && m.side !== 'tie-break') as BracketMatch;
    const refused = await host('POST', '/api/bracket/undo', { resultId: oldest.resultId });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'undo-later-first' });

    bracket = await playToTheEnd(winner);
    expect(bracket.finished).toBe(true);
    expect(bracket.ties).toEqual([]);
    const places = bracket.standings.map((row) => row.place);
    expect(places.slice(0, 3)).toEqual([1, 2, 3]);
    expect(bracket.standings.slice(0, 3).map((row) => row.player.id)).toEqual([p1, p2, p3]);
    expect(bracket.standings).toHaveLength(6);
    expect(bracket.lateOpen).toBe(false);
    // A finished round robin is over for late players, too.
    expect((await host('POST', '/api/bracket/players', { playerId: ids[6] })).json()).toEqual({ error: 'late-closed' });
    // The database holds exactly what the answer was made from.
    expect(await get()).toEqual(bracket);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bracket_results').get()).toEqual({ n: bracket.matches.filter((m) => m.status === 'done').length });

    // Delete it, and a new bracket can start at once.
    expect((await host('DELETE', '/api/bracket')).statusCode).toBe(204);
    expect(await get()).toBeNull();
  });
});

describe('elimination through the routes', () => {
  it.each([
    ['one life', 'single', 5, 0],
    ['two lives, the first final decides', 'double', 4, 0],
    ['two lives, the rematch is played', 'double', 4, 1],
  ] as const)('plays %s to a finish with the podium in place', async (_name, format, count, slot) => {
    expect((await host('POST', '/api/bracket', { format, bestOf: 1, stations: 2, playerIds: ids.slice(0, count) })).statusCode).toBe(201);
    const bracket = await playToTheEnd((match) => match.slots[slot]?.player?.id as number);
    expect(bracket.finished).toBe(true);
    expect(bracket.standings).toHaveLength(count);
    expect(bracket.standings.slice(0, 3).map((row) => row.place)).toEqual([1, 2, 3]);
    expect(bracket.stations.every((s) => s.match === null)).toBe(true);
    expect(bracket.upNext).toEqual([]);
    if (format === 'double' && slot === 1) expect(bracket.matches.some((m) => m.side === 'rematch')).toBe(true);
    if (format === 'double' && slot === 0) expect(bracket.matches.some((m) => m.side === 'rematch')).toBe(false);
    // A finished bracket gives way to a new one, and the new one is a fresh start.
    const next = await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 2) });
    expect(next.statusCode).toBe(201);
    expect(next.json().bracket.lastResultId).toBeNull();
  });

  it('lets a late player take a bye and play the match that bye opens', async () => {
    const created = await host('POST', '/api/bracket', { format: 'single', bestOf: 1, stations: 1, playerIds: ids.slice(0, 5) });
    const start = created.json().bracket as Bracket;
    expect(start.lateOpen).toBe(true);
    const late = await host('POST', '/api/bracket/players', { playerId: ids[5] });
    expect(late.statusCode, late.body).toBe(200);
    const withLate = late.json().bracket as Bracket;
    const seen = withLate.matches.flatMap((m) => playerIds(m));
    expect(seen).toContain(ids[5]);
    const bracket = await playToTheEnd((match) => match.slots[0]?.player?.id as number);
    expect(bracket.standings).toHaveLength(6);
  });
});
