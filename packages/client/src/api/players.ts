// Calls to the players API (docs/PLAN.md, section 4). Every call resolves to a Result
// (request.ts): a screen switches on `ok` and `error`, and never has to catch.

import type {
  HandleBody,
  HandlePinBody,
  MergeBody,
  NewPlayerAnswer,
  PinAnswer,
  Player,
  PlayerAnswer,
  PlayersAnswer,
  SignupCheckAnswer,
} from '@coliseumgrid/core';
import { call } from './request.ts';

export const checkSignup = (handle: string) =>
  call<SignupCheckAnswer>('POST', '/api/signup/check', { handle } satisfies HandleBody);

export const signUp = (handle: string, pin: string) =>
  call<PlayerAnswer>('POST', '/api/signup', { handle, pin } satisfies HandlePinBody);

export const claimHandle = (handle: string, pin: string) =>
  call<PlayerAnswer>('POST', '/api/signup/claim', { handle, pin } satisfies HandlePinBody);

export const listPlayers = () => call<PlayersAnswer>('GET', '/api/players');

export const addPlayer = (handle: string) =>
  call<NewPlayerAnswer>('POST', '/api/players', { handle } satisfies HandleBody);

export const renamePlayer = (id: number, handle: string) =>
  call<PlayerAnswer>('PATCH', `/api/players/${id}`, { handle } satisfies HandleBody);

/** Deletes player `id` and keeps `intoId`. The server answers with the player kept. */
export const mergePlayer = (id: number, intoId: number) =>
  call<PlayerAnswer>('POST', `/api/players/${id}/merge`, { intoId } satisfies MergeBody);

export const resetPin = (id: number) => call<PinAnswer>('POST', `/api/players/${id}/reset-pin`);

export type { Player };
