// Calls for host sign-in, pairing codes, devices, and the event (docs/PLAN.md, section 3,
// "Devices and host API").

import type {
  DeviceAnswer,
  DeviceRole,
  DevicesAnswer,
  EventAnswer,
  EventBody,
  EventPlan,
  HostSessionAnswer,
  JoinBody,
  NewEventAnswer,
  PairingCodeAnswer,
  PairingCodeBody,
  PasswordBody,
  PlanAnswer,
  PlanBody,
  PlanNowAnswer,
} from '@coliseumgrid/core';
import { call } from './request.ts';

export const getHostSession = () => call<HostSessionAnswer>('GET', '/api/host/session');

/** First-run password, offline from the laptop only. Signs the host in. */
export const setUpHost = (password: string) =>
  call<void>('POST', '/api/host/setup', { password } satisfies PasswordBody);

export const signInHost = (password: string) =>
  call<void>('POST', '/api/host/sign-in', { password } satisfies PasswordBody);

export const signOutHost = () => call<void>('POST', '/api/host/sign-out');

export const makePairingCode = (role: DeviceRole) =>
  call<PairingCodeAnswer>('POST', '/api/pairing/codes', { role } satisfies PairingCodeBody);

export const listDevices = () => call<DevicesAnswer>('GET', '/api/devices');

/** The server closes the device's live connection and its token stops working. */
export const unpairDevice = (id: number) => call<void>('DELETE', `/api/devices/${id}`);

/** `code` can be as typed: the server reads any case, with or without the dash. */
export const joinWithCode = (code: string) => call<DeviceAnswer>('POST', '/api/devices/join', { code } satisfies JoinBody);

/** This browser's own pairing, or 401 not-paired. */
export const getMyDevice = () => call<DeviceAnswer>('GET', '/api/devices/me');

export const getEvent = () => call<EventAnswer>('GET', '/api/event');

/**
 * Renames the event. A `game` left out keeps the stored one, and an empty string clears it
 * (docs/PLAN.md, "The setup wizard", "Storage and routes").
 */
export const saveEvent = (name: string, game?: string) =>
  call<EventAnswer>('PUT', '/api/event', { name, ...(game !== undefined && { game }) } satisfies EventBody);

/**
 * A new event that becomes the current one. The old one keeps its bracket or groups; players
 * sign up again. 409 bracket-running while a competition is being played.
 */
export const createEvent = (name: string, game: string) =>
  call<NewEventAnswer>('POST', '/api/events', { name, ...(game !== '' && { game }) } satisfies EventBody);

/** The wizard's choices, kept on the server so a reload or a second window finds them. */
export const getPlan = () => call<PlanAnswer>('GET', '/api/event/plan');

export const savePlan = (plan: EventPlan) => call<PlanNowAnswer>('PUT', '/api/event/plan', { plan } satisfies PlanBody);
