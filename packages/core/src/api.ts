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
  | 'server-error'
  | 'not-signed-in'
  | 'forbidden'
  | 'wrong-password'
  | 'wrong-code'
  | 'not-paired';

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

// Devices and host API (docs/PLAN.md, "Devices and host API"), from M3.

export type DeviceRole = 'display' | 'signup';

/** The only device fields that leave the server. `lastSeen` is an ISO 8601 time. */
export interface Device {
  id: number;
  role: DeviceRole;
  label: string;
  lastSeen: string;
}

export interface EventInfo {
  name: string;
}

/** GET /api/host/session */
export interface HostSessionAnswer {
  signedIn: boolean;
  passwordSet: boolean;
  canSetUp: boolean;
}

/** POST /api/host/setup and POST /api/host/sign-in */
export interface PasswordBody {
  password: string;
}

/** POST /api/pairing/codes */
export interface PairingCodeBody {
  role: DeviceRole;
}

/** POST /api/pairing/codes. `code` is the canonical 6 characters; `expiresAt` is ISO 8601. */
export interface PairingCodeAnswer {
  code: string;
  role: DeviceRole;
  expiresAt: string;
}

/** POST /api/devices/join */
export interface JoinBody {
  code: string;
}

/** POST /api/devices/join and GET /api/devices/me */
export interface DeviceAnswer {
  device: Device;
}

/** GET /api/devices */
export interface DevicesAnswer {
  devices: Device[];
}

/** GET and PUT /api/event */
export interface EventAnswer {
  event: EventInfo | null;
}

/** PUT /api/event */
export interface EventBody {
  name: string;
}

/** Messages the server sends on GET /api/live. */
export type LiveMessage =
  | { type: 'event'; event: EventInfo | null }
  | { type: 'players' }
  | { type: 'unpaired' };
