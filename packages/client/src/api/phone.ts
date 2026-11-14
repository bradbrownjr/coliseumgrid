// Calls to the phone API (docs/PLAN.md, "Phone API"). Every call resolves to a Result
// (request.ts): a screen switches on `ok` and `error`, and never has to catch.

import type {
  FollowCodeBody,
  HandlePinBody,
  PhoneAnswer,
  PhoneFollowingAnswer,
  PhonePushKeyAnswer,
  PushSubscriptionBody,
} from '@coliseumgrid/core';
import { call } from './request.ts';

/** Handle and PIN. The first follow makes the phone's row and sets its cookie. */
export const followPlayer = (handle: string, pin: string) =>
  call<PhoneFollowingAnswer>('POST', '/api/phone/follow', { handle, pin } satisfies HandlePinBody);

/** `code` can be as typed or as scanned; the server reads it like a pairing code. */
export const followWithCode = (code: string) =>
  call<PhoneFollowingAnswer>('POST', '/api/phone/follow-code', { code } satisfies FollowCodeBody);

/** The one answer a phone gets about the competition. 401 `not-following` when it follows nobody. */
export const getPhone = () => call<PhoneAnswer>('GET', '/api/phone');

/** Stopping the last follow signs the phone out. */
export const stopFollowing = (playerId: number) => call<PhoneFollowingAnswer>('DELETE', `/api/phone/follow/${playerId}`);

export const signOutPhone = () => call<void>('POST', '/api/phone/sign-out');

/** `publicKey` is null offline and over plain HTTP: the page then offers no push. */
export const getPushKey = () => call<PhonePushKeyAnswer>('GET', '/api/phone/push');

export const savePushSubscription = (subscription: PushSubscriptionBody) => call<void>('PUT', '/api/phone/push', subscription);

export const removePushSubscription = () => call<void>('DELETE', '/api/phone/push');
