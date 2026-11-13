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

/** `order` is the group's players from 1st to last, each once. */
export const recordHeat = (heatId: number, order: number[]) =>
  call<HeatResultAnswer>('POST', '/api/heats/results', { heatId, order } satisfies HeatResultBody);

/** The newest result comes off exactly; an older one reopens its group without moving anyone playing. */
export const undoHeat = (resultId: number) =>
  call<HeatsNowAnswer>('POST', '/api/heats/undo', { resultId } satisfies HeatUndoBody);

/** A late player, while the answer's `lateOpen` is true. */
export const addLateHeatPlayer = (playerId: number) =>
  call<HeatsNowAnswer>('POST', '/api/heats/players', { playerId } satisfies HeatPlayerBody);

/** Makes the tie-break races for a tie at the cut for the final. */
export const startHeatTieBreak = () => call<HeatsNowAnswer>('POST', '/api/heats/tie-break');

/** Can't be undone, so the host screen asks first. */
export const deleteHeats = () => call<void>('DELETE', '/api/heats');
