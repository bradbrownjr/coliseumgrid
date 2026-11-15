// Calls for groups: races and free-for-alls (docs/PLAN.md, section 5, "Heats API"). On screen a
// heat is a "Group".

import type {
  HeatArrivedBody,
  HeatPlayerBody,
  HeatResultAnswer,
  HeatResultBody,
  HeatsAnswer,
  HeatsNowAnswer,
  HeatUndoBody,
  NewHeatsBody,
} from '@coliseumgrid/core';
import { withServerClock } from './clock.ts';
import { call } from './request.ts';

/** The groups, or `{ heats: null }` before any are made. Host or any paired device. */
export const getHeats = () => withServerClock(() => call<HeatsAnswer>('GET', '/api/heats'));

// Every call below that answers with the groups also learns the server's clock (`withServerClock`).
export const startHeats = (body: NewHeatsBody) => withServerClock(() => call<HeatsNowAnswer>('POST', '/api/heats', body));

/**
 * `order` is the players who played, 1st first, and `missing` the ones who didn't come: together
 * the group's players, each once, with at least one in `order`. A missing player scores 0 points.
 */
export const recordHeat = (heatId: number, order: number[], missing: number[] = []) =>
  withServerClock(() =>
    call<HeatResultAnswer>('POST', '/api/heats/results', { heatId, order, ...(missing.length > 0 && { missing }) } satisfies HeatResultBody),
  );

/** The newest result comes off exactly; an older one reopens its group without moving anyone playing. */
export const undoHeat = (resultId: number) =>
  withServerClock(() => call<HeatsNowAnswer>('POST', '/api/heats/undo', { resultId } satisfies HeatUndoBody));

/** A late player, while the answer's `lateOpen` is true. */
export const addLateHeatPlayer = (playerId: number) =>
  withServerClock(() => call<HeatsNowAnswer>('POST', '/api/heats/players', { playerId } satisfies HeatPlayerBody));

/** Makes the tie-break groups for a tie at the cut for the final. */
export const startHeatTieBreak = () => withServerClock(() => call<HeatsNowAnswer>('POST', '/api/heats/tie-break'));

/** **They're here** for the group on a station, or with `arrived` false the Undo that takes it back. Host only. */
export const markHeatArrived = (heatId: number, arrived = true) =>
  withServerClock(() => call<HeatsNowAnswer>('POST', '/api/heats/arrived', { heatId, arrived } satisfies HeatArrivedBody));

/** Can't be undone, so the host screen asks first. */
export const deleteHeats = () => call<void>('DELETE', '/api/heats');
