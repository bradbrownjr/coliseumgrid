// Shared by the tests that drive the heats API through app.inject. Callers, players, and the
// API type come from bracket-api-helpers.ts.

import { DEFAULT_POINTS, type Heat, type Heats } from '@coliseumgrid/core';
import { expect } from 'vitest';
import type { Api } from './bracket-api-helpers.ts';

const sorted = (keys: string[]): string[] => [...keys].sort();

/** Every object in an answer has exactly the fields the contract lists, and a player is { id, handle }. */
export function expectHeatsShape(heats: Heats): void {
  const keys = (value: object): string[] => sorted(Object.keys(value));
  const player = (p: object): void => expect(keys(p)).toEqual(['handle', 'id']);
  const heat = (h: Heat): void => {
    expect(keys(h)).toEqual(sorted(['id', 'kind', 'round', 'number', 'status', 'players', 'order', 'resultId']));
    h.players.forEach(player);
    h.order?.forEach(player);
  };
  expect(keys(heats)).toEqual(
    sorted([
      'id', 'races', 'rounds', 'points', 'finished', 'lateOpen', 'lastResultId', 'round',
      'stations', 'upNext', 'heats', 'standings', 'finalSize', 'ties',
    ]),
  );
  heats.heats.forEach(heat);
  heats.upNext.forEach(heat);
  for (const station of heats.stations) {
    expect(keys(station)).toEqual(['calledAt', 'heat', 'number']);
    if (station.heat) heat(station.heat);
  }
  for (const row of heats.standings) {
    expect(keys(row)).toEqual(['heatsPlayed', 'place', 'player', 'points']);
    player(row.player);
  }
  for (const tie of heats.ties) {
    expect(keys(tie)).toEqual(['place', 'players', 'started']);
    tie.players.forEach(player);
  }
}

/** The heats on stations in a heats answer. */
export const heatsOnStations = (heats: Heats): Heat[] => heats.stations.flatMap((s) => (s.heat ? [s.heat] : []));

export interface NewHeatsOptions {
  stations?: number;
  races?: number;
  rounds?: number;
  points?: readonly number[];
}

/** The body of POST /api/heats. */
export const heatsBody = (playerIds: number[], options: NewHeatsOptions = {}) => ({
  stations: options.stations ?? 2,
  races: options.races ?? 2,
  rounds: options.rounds ?? 2,
  points: [...(options.points ?? DEFAULT_POINTS)],
  playerIds,
});

/** Makes heats as `host` and checks they were made. */
export async function makeHeats(host: Api, playerIds: number[], options: NewHeatsOptions = {}): Promise<Heats> {
  const res = await host('POST', '/api/heats', heatsBody(playerIds, options));
  expect(res.statusCode, res.body).toBe(201);
  return res.json().heats;
}

/** Records a heat's players as finishing in the order listed; the answer is the route's. */
export const recordListed = (host: Api, heat: Heat) =>
  host('POST', '/api/heats/results', { heatId: heat.id, order: heat.players.map((p) => p.id) });

/**
 * Plays every heat on a station, in the order listed, until none is on a station. A tie at the
 * cut is left waiting. Returns the last answer.
 */
export async function playListed(host: Api, heats: Heats): Promise<Heats> {
  let now = heats;
  for (let guard = 0; guard < 100; guard++) {
    const heat = heatsOnStations(now)[0];
    if (!heat) return now;
    const res = await recordListed(host, heat);
    expect(res.statusCode, res.body).toBe(200);
    now = res.json().heats;
  }
  throw new Error('the heats never stopped');
}
