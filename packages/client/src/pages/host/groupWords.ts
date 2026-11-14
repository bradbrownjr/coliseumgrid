// The words and small calculations behind the host screen's groups (races and free-for-all).
// No React in here, so tests can call them directly. A heat is a "Group" on screen
// (docs/DOC-STYLE.md, "Tournament words on screen").

import {
  FINAL_SIZE,
  HEAT_PLAYERS_MAX,
  HEAT_PLAYERS_MIN,
  HEAT_POINTS_MAX,
  HEAT_SIZE_MAX,
  hasQualifying,
  isPointsTable,
  splitHeats,
  type Heat,
  type Heats,
  type Player,
  type RacesPerHeat,
} from '@coliseumgrid/core';
import { joinHandles } from '../../handles.ts';
import { noResultsYet } from '../../heatsWords.ts';
import { placeWords, stationWords } from './bracketWords.ts';

/** "Round 2, group 3", "Final", "Tie-break group". Tie-break heats are numbered only when a pass has more than one. */
export function heatTitle(heat: Pick<Heat, 'kind' | 'round' | 'number'>, all: readonly Pick<Heat, 'kind' | 'round'>[] = []): string {
  if (heat.kind === 'final') return 'Final';
  if (heat.kind === 'round') return `Round ${heat.round}, group ${heat.number}`;
  const sameRound = all.filter((other) => other.kind === 'tie-break' && other.round === heat.round).length;
  const name = sameRound > 1 ? `Tie-break group ${heat.number}` : 'Tie-break group';
  return heat.round > 1 ? `${name}, try ${heat.round}` : name;
}

/** "1st Zap, 2nd Kai, 3rd Blaze". */
export function orderWords(order: readonly Pick<Player, 'handle'>[]): string {
  return order.map((player, i) => `${placeWords(i + 1)} ${player.handle}`).join(', ');
}

/** "Saved: Round 1, group 3". */
export function savedWords(heat: Pick<Heat, 'kind' | 'round' | 'number'>, all: readonly Pick<Heat, 'kind' | 'round'>[]): string {
  return `Saved: ${heatTitle(heat, all)}`;
}

/** Heats that are done, newest result first. `resultId` grows with each result. */
export function doneHeats(heats: Heats): Heat[] {
  return heats.heats.filter((heat) => heat.status === 'done' && heat.resultId !== null).sort((a, b) => (b.resultId ?? 0) - (a.resultId ?? 0));
}

/**
 * True while the heat is on a station in this answer: the only time "Record result" can work.
 * Taking back a result can remove a group the host has open, so the record dialog checks this
 * on every answer (the server refuses it with 404 `not-found` or 409 `not-on-station`).
 */
export function heatOnStation(heats: Pick<Heats, 'stations'>, heatId: number): boolean {
  return heats.stations.some((station) => station.heat?.id === heatId);
}

/** The ids of every player in the groups, for "Add to group" on the players still out. */
export function playersInHeats(heats: Heats): Set<number> {
  const ids = new Set<number>();
  for (const heat of heats.heats) for (const player of heat.players) ids.add(player.id);
  for (const row of heats.standings) ids.add(row.player.id);
  return ids;
}

/** Where the groups stand, in a few words: "Round 1 of 2", "Tie-break", "Final", "Finished". */
export function phaseWords(heats: Pick<Heats, 'finished' | 'round' | 'rounds' | 'ties' | 'heats'>): string {
  if (heats.finished) return 'Finished';
  if (heats.round !== null) return `Round ${heats.round} of ${heats.rounds}`;
  if (heats.heats.some((heat) => heat.kind === 'final')) return 'Final';
  return heats.ties.length > 0 ? 'Tie-break' : 'Final';
}

/**
 * "1 game", "3 games". A game is a race or a match: a Smash free-for-all has no races, which
 * is why a heat is a "Group" on screen (docs/DOC-STYLE.md, "Tournament words on screen").
 */
export function gameCount(games: number): string {
  return games === 1 ? '1 game' : `${games} games`;
}

/** The start dialog's words for the games setting: the host records one order per group. */
export function gamesWords(games: RacesPerHeat): string {
  return games === 1
    ? 'Each group plays 1 game, a race or a match. Record the order they finish.'
    : `Each group plays ${games} games, each a race or a match. Record the order after all of them.`;
}

/** What the record dialog asks the host to tap. */
export function recordHelp(games: RacesPerHeat): string {
  return games === 1 ? 'Tap the players in the order they finished.' : `Tap the players in their order after all ${games} games.`;
}

/** The rounds line: with 2 to 4 players there are no rounds. */
export function roundsWords(rounds: number, playerCount: number): string {
  if (!hasQualifying(playerCount)) return 'With 2 to 4 players there are no rounds, only the final.';
  return `Everyone plays ${rounds === 1 ? '1 round' : `${rounds} rounds`} of groups. Then the top ${FINAL_SIZE} play the final.`;
}

/** "3 groups: 4, 3, and 3 players", or the one-group case for 2 to 4 players. */
export function groupSizesWords(playerCount: number): string | null {
  if (playerCount < HEAT_PLAYERS_MIN || playerCount > HEAT_PLAYERS_MAX) return null;
  if (!hasQualifying(playerCount)) return 'One group plays the final.';
  const sizes = splitHeats(playerCount);
  return `${sizes.length} groups in round 1: ${joinHandles(sizes.map((size) => ({ handle: String(size) })))} players.`;
}

/**
 * Why a pick of `count` players can't start groups, or null when it can. Checked before sending
 * so the host reads it in plain words; the server checks again.
 */
export function groupsProblem(count: number): string | null {
  if (count > HEAT_PLAYERS_MAX) return `Pick ${HEAT_PLAYERS_MAX} players at most.`;
  if (count < HEAT_PLAYERS_MIN) return `Pick at least ${HEAT_PLAYERS_MIN} players.`;
  return null;
}

/** The points a host typed for 1st to 4th, as numbers, or null if one isn't a whole number. */
export function parsePoints(typed: readonly string[]): number[] | null {
  if (typed.length !== HEAT_SIZE_MAX) return null;
  const numbers = typed.map((text) => (/^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN));
  return numbers.every(Number.isInteger) ? numbers : null;
}

/** Why a points table can't be used, in plain words, or null when `isPointsTable` accepts it. */
export function pointsProblem(typed: readonly string[]): string | null {
  const points = parsePoints(typed);
  const whole = `Use whole numbers from 0 to ${HEAT_POINTS_MAX}.`;
  if (points === null || points.some((p) => p > HEAT_POINTS_MAX)) return whole;
  if ((points[0] ?? 0) < 1) return '1st place needs at least 1 point.';
  for (let i = 1; i < points.length; i++) {
    if ((points[i] ?? 0) > (points[i - 1] ?? 0)) return `${placeWords(i + 1)} can't score more than ${placeWords(i)}.`;
  }
  return isPointsTable(points) ? null : whole;
}

/** "4, 3, 2, 1". */
export function pointsWords(points: readonly number[]): string {
  return points.join(', ');
}

/** The line under the section title: kind, stations, games, and points. Only the final scores places, so 2 to 4 players have no points. */
export function groupsSummary(heats: Pick<Heats, 'stations' | 'races' | 'points' | 'rounds'>): string {
  const line = `Races and free-for-all, ${stationWords(heats.stations.length)}. Each group plays ${gameCount(heats.races)}.`;
  return heats.rounds === 0 ? line : `${line} Points for 1st to 4th: ${pointsWords(heats.points)}.`;
}

// What the record dialog shows while the host taps players in order (docs/PLAN.md, "Races and
// free-for-all": recording is once per group).

export interface OrderEntry {
  /** Players tapped so far, 1st first. */
  picked: Player[];
  /** Players not tapped yet. Empty once the order is complete. */
  remaining: Player[];
  /** The whole order once every player has a place: the last one is filled in. Null before that. */
  complete: Player[] | null;
}

/** `pickedIds` are tapped player ids; ones that aren't in the group, or repeat, are ignored. */
export function orderEntry(players: readonly Player[], pickedIds: readonly number[]): OrderEntry {
  const picked: Player[] = [];
  for (const id of pickedIds) {
    const player = players.find((candidate) => candidate.id === id);
    if (player && !picked.includes(player)) picked.push(player);
  }
  let remaining = players.filter((player) => !picked.includes(player));
  // With one player left there is only one place left for them.
  if (remaining.length === 1 && picked.length > 0) {
    picked.push(...remaining);
    remaining = [];
  }
  return { picked, remaining, complete: remaining.length === 0 && picked.length === players.length ? picked : null };
}

/** The record dialog's title: "Who came 1st?", then "Is this the order?" once the order is complete. */
export function orderQuestion(entry: OrderEntry): string {
  return entry.complete ? 'Is this the order?' : `Who came ${placeWords(entry.picked.length + 1)}?`;
}

/**
 * Standings help once a group has a result: before that everyone is level on 0 points and there
 * are no places to show, as on the Display. With 2 to 4 players there are no qualifying points,
 * so they show only once the final has places.
 */
export function showStandings(heats: Heats): boolean {
  if (heats.finished) return heats.standings.length > 0;
  return showsPoints(heats) && heats.standings.length > 0 && !noResultsYet(heats);
}

/** The final standings table doesn't need a points column when 2 to 4 players played only the final. */
export function showsPoints(heats: Pick<Heats, 'rounds'>): boolean {
  return heats.rounds > 0;
}

