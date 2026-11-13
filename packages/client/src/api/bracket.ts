// Calls for the bracket and the current event's players (docs/PLAN.md, section 5,
// "Brackets API").

import type {
  BracketAnswer,
  BracketNowAnswer,
  BracketPlayerBody,
  BracketResultAnswer,
  BracketResultBody,
  BracketUndoBody,
  EventPlayersAnswer,
  NewBracketBody,
} from '@coliseumgrid/core';
import { call } from './request.ts';

/** The bracket, or `{ bracket: null }` before one is made. Host or any paired device. */
export const getBracket = () => call<BracketAnswer>('GET', '/api/bracket');

export const startBracket = (body: NewBracketBody) => call<BracketNowAnswer>('POST', '/api/bracket', body);

export const recordResult = (matchId: number, winnerId: number) =>
  call<BracketResultAnswer>('POST', '/api/bracket/results', { matchId, winnerId } satisfies BracketResultBody);

/** Any result can be undone while no later result depends on it; otherwise 409 undo-later-first. */
export const undoResult = (resultId: number) =>
  call<BracketNowAnswer>('POST', '/api/bracket/undo', { resultId } satisfies BracketUndoBody);

/** A late player, while the bracket answer's `lateOpen` is true. */
export const addLatePlayer = (playerId: number) =>
  call<BracketNowAnswer>('POST', '/api/bracket/players', { playerId } satisfies BracketPlayerBody);

/** Makes the matches for the ties listed in the bracket answer. */
export const startTieBreak = () => call<BracketNowAnswer>('POST', '/api/bracket/tie-break');

/** Can't be undone, so the host screen asks first. */
export const deleteBracket = () => call<void>('DELETE', '/api/bracket');

export const getEventPlayers = () => call<EventPlayersAnswer>('GET', '/api/event/players');
