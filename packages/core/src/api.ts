// The players API's request and answer shapes (docs/PLAN.md, "Players API"), shared so the
// server and the client can't drift apart. Types only: nothing here runs.

import type { HandleRefusal } from './handle.ts';

/** The only player fields that leave the server (CLAUDE.md, rule 1). */
export interface Player {
  id: number;
  handle: string;
}

export type ApiErrorCode =
  | 'refused'
  | 'taken'
  | 'bad-pin'
  | 'wrong-pin'
  | 'not-found'
  | 'too-many-tries'
  | 'bad-request'
  | 'server-error';

export type ApiError =
  | { error: 'refused'; reason: HandleRefusal }
  | { error: Exclude<ApiErrorCode, 'refused'> };

export interface HandleBody {
  handle: string;
}

export interface HandlePinBody {
  handle: string;
  pin: string;
}

export interface MergeBody {
  intoId: number;
}

/** POST /api/signup/check */
export type SignupCheckAnswer =
  | { status: 'available'; handle: string; suggestedPin: string }
  | { status: 'taken'; handle: string };

/** POST /api/signup and POST /api/signup/claim; PATCH /api/players/:id; POST .../merge */
export interface PlayerAnswer {
  player: Player;
}

/** GET /api/players */
export interface PlayersAnswer {
  players: Player[];
}

/** POST /api/players */
export interface NewPlayerAnswer {
  player: Player;
  pin: string;
}

/** POST /api/players/:id/reset-pin */
export interface PinAnswer {
  pin: string;
}
