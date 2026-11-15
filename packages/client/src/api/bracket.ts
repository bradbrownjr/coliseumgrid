// Calls for the bracket and the current event's players (docs/PLAN.md, section 5,
// "Brackets API").

import type {
  BracketAnswer,
  BracketArrivedBody,
  BracketNowAnswer,
  BracketPlayerBody,
  BracketResultAnswer,
  BracketResultBody,
  BracketUndoBody,
  EventPlayersAnswer,
  NewBracketBody,
} from '@coliseumgrid/core';
import { withServerClock } from './clock.ts';
import { call } from './request.ts';

/** The bracket, or `{ bracket: null }` before one is made. Host or any paired device. */
export const getBracket = () => withServerClock(() => call<BracketAnswer>('GET', '/api/bracket'));

// Every call below that answers with the bracket also learns the server's clock (`withServerClock`).
export const startBracket = (body: NewBracketBody) => withServerClock(() => call<BracketNowAnswer>('POST', '/api/bracket', body));

/** With `forfeit`, the winner is the player who came, and the other didn't (docs/PLAN.md, "Waiting for a missing player"). */
export const recordResult = (matchId: number, winnerId: number, forfeit = false) =>
  withServerClock(() =>
    call<BracketResultAnswer>('POST', '/api/bracket/results', { matchId, winnerId, ...(forfeit && { forfeit }) } satisfies BracketResultBody),
  );

/** Any result can be undone while no later result depends on it; otherwise 409 undo-later-first. */
export const undoResult = (resultId: number) =>
  withServerClock(() => call<BracketNowAnswer>('POST', '/api/bracket/undo', { resultId } satisfies BracketUndoBody));

/** A late player, while the bracket answer's `lateOpen` is true. */
export const addLatePlayer = (playerId: number) =>
  withServerClock(() => call<BracketNowAnswer>('POST', '/api/bracket/players', { playerId } satisfies BracketPlayerBody));

/** Makes the matches for the ties listed in the bracket answer. */
export const startTieBreak = () => withServerClock(() => call<BracketNowAnswer>('POST', '/api/bracket/tie-break'));

/**
 * **They're here** for the match on a station, or with `arrived` false the Undo that takes it
 * back (docs/PLAN.md, "Waiting for a missing player"). Host only.
 */
export const markArrived = (matchId: number, arrived = true) =>
  withServerClock(() => call<BracketNowAnswer>('POST', '/api/bracket/arrived', { matchId, arrived } satisfies BracketArrivedBody));

/** Can't be undone, so the host screen asks first. */
export const deleteBracket = () => call<void>('DELETE', '/api/bracket');

export const getEventPlayers = () => call<EventPlayersAnswer>('GET', '/api/event/players');
