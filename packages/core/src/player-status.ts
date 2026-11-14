// Where one player stands in a bracket or in groups, for the phone page and the push alerts
// (docs/PLAN.md, section 3, "Player view"). It reads only the answers the Display already
// gets, so the server and the client work out the same status from the same answer.

import type { Bracket, FollowStatus, Heats, Player, PlayerStatus } from './api.ts';

/** The most handles one phone follows (a parent with several kids). */
export const PHONE_FOLLOWS_MAX = 6;

/** A match or a group, whichever the event runs: an id and who is in it, as far as known. */
interface Unit {
  id: number;
  players: Player[];
}

const NOT_IN: PlayerStatus = { status: 'not-in', away: null, station: null, matchId: null, others: [], place: null };

/** The shape of an answer for a player who isn't in the event, or when nothing is running. */
export function notInStatus(): PlayerStatus {
  return { ...NOT_IN, others: [] };
}

/**
 * Works out where a player stands, in this order:
 *
 * 1. On a station: `now`, with the station, the match or group, and who else is in it.
 * 2. In Up next: `next` for the first entry holding the player, `two-away` for the second
 *    (entries, not players: an entry is a match or a group), `later` beyond. `away` is its
 *    place in the list from 1. With several stations, or a player still on one, the queue can
 *    skip an entry, so the page words it as "about".
 * 3. The event is finished: `done` with the final place, or `not-in` for a player who isn't in it.
 * 4. In a match or group that isn't in Up next: `waiting`. That is a bracket match with a
 *    player not known yet, or held back for a first-round bye. A player tied for a place that
 *    has to be played off is also `waiting`, with no match yet.
 * 5. Otherwise `not-in` when no match or group has them, `out` in a bracket, and in groups
 *    `waiting` while the qualifying rounds go on (the next round isn't made) or when the
 *    player's place reaches the final, and `out` below the cut.
 *
 * In a round robin, `out` means every match is played while others go on.
 */
export function playerStatus(answer: Bracket | Heats | null, playerId: number): PlayerStatus {
  if (answer === null) return notInStatus();

  const isBracket = 'matches' in answer;
  const unitOfMatch = (m: Bracket['matches'][number]): Unit => ({
    id: m.id,
    players: m.slots.flatMap((s) => (s.player ? [s.player] : [])),
  });
  const stations = isBracket
    ? answer.stations.map((s) => ({ number: s.number, unit: s.match ? unitOfMatch(s.match) : null }))
    : answer.stations.map((s) => ({ number: s.number, unit: s.heat ? { id: s.heat.id, players: s.heat.players } : null }));
  const upNext: Unit[] = isBracket ? answer.upNext.map(unitOfMatch) : answer.upNext.map((h) => ({ id: h.id, players: h.players }));

  const mine = (u: Unit): boolean => u.players.some((p) => p.id === playerId);
  const inUnit = (u: Unit, status: FollowStatus, extra: Partial<PlayerStatus> = {}): PlayerStatus => ({
    ...NOT_IN,
    status,
    matchId: u.id,
    others: u.players.filter((p) => p.id !== playerId),
    ...extra,
  });

  const onStation = stations.find((s) => s.unit !== null && mine(s.unit));
  if (onStation?.unit) return inUnit(onStation.unit, 'now', { away: 0, station: onStation.number });

  const index = upNext.findIndex(mine);
  if (index >= 0) {
    const away = index + 1;
    return inUnit(upNext[index] as Unit, away === 1 ? 'next' : away === 2 ? 'two-away' : 'later', { away });
  }

  const row = answer.standings.find((r) => r.player.id === playerId);
  if (answer.finished) return row ? { ...NOT_IN, status: 'done', place: row.place } : notInStatus();

  // A match or group made and not played, and not in Up next.
  const pending: Unit[] = isBracket
    ? answer.matches.filter((m) => m.status === 'waiting' || m.status === 'ready').map(unitOfMatch)
    : answer.heats.filter((h) => h.status === 'ready').map((h) => ({ id: h.id, players: h.players }));
  const waiting = pending.find(mine);
  if (waiting) return inUnit(waiting, 'waiting');
  if (answer.ties.some((t) => t.players.some((p) => p.id === playerId))) return { ...NOT_IN, status: 'waiting' };

  const known = isBracket
    ? answer.matches.some((m) => m.slots.some((s) => s.player?.id === playerId)) || row !== undefined
    : row !== undefined || answer.heats.some((h) => h.players.some((p) => p.id === playerId));
  if (!known) return notInStatus();
  if (isBracket) return { ...NOT_IN, status: 'out' };

  // Groups: nobody is knocked out before the final, so a player between rounds is waiting.
  if (answer.round !== null) return { ...NOT_IN, status: 'waiting' };
  return { ...NOT_IN, status: row && row.place <= answer.finalSize ? 'waiting' : 'out' };
}

/**
 * How loud the page is for a status: `called` is the full-screen alert, `next` a banner,
 * `two-away` a line of text on the card, and `none` nothing (docs/PLAN.md, "Player view").
 */
export type AlertLevel = 'called' | 'next' | 'two-away' | 'none';

export function alertLevel(status: Pick<PlayerStatus, 'status'>): AlertLevel {
  switch (status.status) {
    case 'now':
      return 'called';
    case 'next':
      return 'next';
    case 'two-away':
      return 'two-away';
    default:
      return 'none';
  }
}

/** The part of a status that decides whether an alert is new. */
export type AlertSource = Pick<PlayerStatus, 'status' | 'matchId'>;

/**
 * The alert a change of status calls for, or null. `called` when the player becomes `now`, or
 * stays `now` on a different match or group (a reopened match is the same id, but it passes
 * through another status first). `next` when the player becomes `next`. With no earlier
 * status (the first load, a newly followed player) there is nothing to compare, so no alert.
 */
export function newAlert(prev: AlertSource | null, next: AlertSource): 'called' | 'next' | null {
  if (prev === null) return null;
  if (next.status === 'now' && !(prev.status === 'now' && prev.matchId === next.matchId)) return 'called';
  if (next.status === 'next' && prev.status !== 'next') return 'next';
  return null;
}
