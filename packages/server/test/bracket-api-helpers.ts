// Shared by the tests that drive the brackets API through app.inject.

import type { Bracket, BracketMatch } from '@coliseumgrid/core';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import type { Database } from '../src/database.ts';
import { withCookie } from './helpers.ts';

/** Adds `count` players straight to the table (no PIN hashing), named Player1, Player2, ...; returns their ids. */
export function addPlayers(db: Database, count: number, from = 1): number[] {
  const insert = db.prepare("INSERT INTO players (handle, handle_key, pin_hash, created_at) VALUES (?, ?, 'x', 't')");
  return Array.from({ length: count }, (_, i) => {
    const handle = `Player${from + i}`;
    return Number(insert.run(handle, handle.toLowerCase()).lastInsertRowid);
  });
}

export interface Api {
  (method: InjectOptions['method'], url: string, payload?: object): Promise<LightMyRequestResponse>;
}

/** A caller that sends `cookie` with every request. */
export function caller(app: FastifyInstance, cookie: string): Api {
  return (method, url, payload) => withCookie(app, cookie, { method, url, ...(payload && { payload }) });
}

const sorted = (keys: string[]): string[] => [...keys].sort();

/** Every object in an answer has exactly the fields the contract lists, and a player is { id, handle }. */
export function expectContractShape(bracket: Bracket): void {
  const keys = (value: object): string[] => sorted(Object.keys(value));
  const player = (p: object | null): void => {
    if (p !== null) expect(keys(p)).toEqual(['handle', 'id']);
  };
  const match = (m: BracketMatch): void => {
    expect(keys(m)).toEqual(sorted(['id', 'side', 'round', 'number', 'status', 'slots', 'winner', 'forfeit', 'resultId']));
    expect(m.slots).toHaveLength(2);
    for (const slot of m.slots) {
      expect(keys(slot)).toEqual(['bye', 'player']);
      player(slot.player);
    }
  };
  expect(keys(bracket)).toEqual(
    sorted(['id', 'format', 'bestOf', 'finished', 'lateOpen', 'lastResultId', 'noShowMinutes', 'stations', 'upNext', 'matches', 'standings', 'ties']),
  );
  bracket.matches.forEach(match);
  bracket.upNext.forEach(match);
  for (const station of bracket.stations) {
    expect(keys(station)).toEqual(['arrived', 'calledAt', 'match', 'number']);
    if (station.match) match(station.match);
  }
  for (const row of bracket.standings) {
    expect(keys(row)).toEqual(['losses', 'place', 'player', 'wins']);
    player(row.player);
  }
  for (const tie of bracket.ties) {
    expect(keys(tie)).toEqual(['place', 'players', 'started']);
    tie.players.forEach(player);
  }
}

/** The matches on stations in a bracket answer. */
export const onStations = (bracket: Bracket): BracketMatch[] => bracket.stations.flatMap((s) => (s.match ? [s.match] : []));

export interface Callers {
  /** The laptop itself: offline, a request from 127.0.0.1 is the host, so no password hashing is needed. */
  host: Api;
  display: Api;
  signup: Api;
  /** A stranger on the network. */
  nobody: Api;
}

const LAPTOP = '127.0.0.1';
const STRANGER = '198.51.100.7';

function from(app: FastifyInstance, remoteAddress: string, cookie?: string): Api {
  return (method, url, payload) =>
    app.inject({ method, url, remoteAddress, ...(payload && { payload }), ...(cookie && { headers: { cookie } }) });
}

/** Pairs a Display and a Sign-up device as the laptop and returns a caller for each role. */
export async function makeCallers(app: FastifyInstance): Promise<Callers> {
  const host = from(app, LAPTOP);
  const pair = async (role: 'display' | 'signup'): Promise<Api> => {
    const code = (await host('POST', '/api/pairing/codes', { role })).json().code as string;
    const joined = await from(app, STRANGER)('POST', '/api/devices/join', { code });
    expect(joined.statusCode).toBe(201);
    const header = joined.headers['set-cookie'];
    const cookie = ((Array.isArray(header) ? header[0] : header) as string).split(';')[0] as string;
    return from(app, STRANGER, cookie);
  };
  return { host, display: await pair('display'), signup: await pair('signup'), nobody: from(app, STRANGER) };
}
