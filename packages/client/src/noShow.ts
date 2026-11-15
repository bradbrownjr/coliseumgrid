// When a station's wait for a missing player is over (docs/PLAN.md, "Waiting for a missing
// player"), for the host's station cards and the TV alike, so both agree. Nothing happens by
// itself: the host is prompted and the TV calls the players.

import type { Player } from '@coliseumgrid/core';
import { joinHandles } from './handles.ts';

/** The mark on a match won by a forfeit, in the host's results list and on the TV's bracket. */
export const FORFEIT_MARK = 'Forfeit';

/** The host's prompt on a station card. */
export const STILL_WAITING = 'Still waiting?';

/** The prompt's button that says the players came: it ends the wait for this call of the match or group. */
export const THEY_ARE_HERE = "They're here";

/** The snackbar after **They're here**, which comes with Undo. */
export const arrivedWords = (station: number): string => `Station ${station}: they're here`;

/** The snackbar after that Undo. */
export const waitingAgainWords = (station: number): string => `Station ${station}: waiting again`;

/**
 * True once `noShowMinutes` have passed since the station was called, unless the host said the
 * players are here (`arrived`, which belongs to this call only). A missing or unreadable call
 * time never counts as over, so a bad clock can't put the prompt up. `now` is the server's time
 * (`useNow`), since `calledAt` is the server's.
 */
export function waitIsOver(calledAt: string | null, noShowMinutes: number, now: number, arrived = false): boolean {
  if (arrived || calledAt === null) return false;
  const called = Date.parse(calledAt);
  if (Number.isNaN(called)) return false;
  return now - called >= noShowMinutes * 60_000;
}

/** The TV's call line, naming everyone, since the TV can't know who is missing: "Zap and Kai, come to station 2!" */
export function callWords(players: readonly Pick<Player, 'handle'>[], station: number): string {
  return `${joinHandles(players)}, come to station ${station}!`;
}

