// Calls for groups: races and free-for-alls (docs/PLAN.md, section 5, "Heats API"). On screen a
// heat is a "Group".

import type {
  HeatPlayerBody,
  HeatResultAnswer,
  HeatResultBody,
  HeatsAnswer,
  HeatsNowAnswer,
  HeatUndoBody,
  NewHeatsBody,
} from '@coliseumgrid/core';
import { call } from './request.ts';

/** The groups, or `{ heats: null }` before any are made. Host or any paired device. */
export const getHeats = () => call<HeatsAnswer>('GET', '/api/heats');

export const startHeats = (body: NewHeatsBody) => call<HeatsNowAnswer>('POST', '/api/heats', body);

/**
 * `order` is the players who played, 1st first, and `missing` the ones who didn't come: together
 * the group's players, each once, with at least one in `order`. A missing player scores 0 points.
 */
export const recordHeat = (heatId: number, order: number[], missing: number[] = []) =>
  call<HeatResultAnswer>('POST', '/api/heats/results', { heatId, order, ...(missing.length > 0 && { missing }) } satisfies HeatResultBody);

/** The newest result comes off exactly; an older one reopens its group without moving anyone playing. */
export const undoHeat = (resultId: number) =>
  call<HeatsNowAnswer>('POST', '/api/heats/undo', { resultId } satisfies HeatUndoBody);

/** A late player, while the answer's `lateOpen` is true. */
export const addLateHeatPlayer = (playerId: number) =>
  call<HeatsNowAnswer>('POST', '/api/heats/players', { playerId } satisfies HeatPlayerBody);

/** Makes the tie-break groups for a tie at the cut for the final. */
export const startHeatTieBreak = () => call<HeatsNowAnswer>('POST', '/api/heats/tie-break');

/** Can't be undone, so the host screen asks first. */
export const deleteHeats = () => call<void>('DELETE', '/api/heats');
