// The page's side of push (docs/PLAN.md, "Player view", "Push"): is it available here, is this
// browser subscribed, and subscribing and unsubscribing. No React, so the logic is tested with
// stubs for the browser's globals. Each function reads the globals when it is called, not when
// the file loads.
//
// Offline, over plain HTTP, and with no push key from the server, the page never reaches this
// file: PushSlot renders the control only for a key. The one exception is `unsubscribeLocal`,
// which only looks at a worker that is already registered and never registers one.

import { failureWords } from '../../api/errors.ts';
import { removePushSubscription, savePushSubscription } from '../../api/phone.ts';

/** Where the service worker is served from (vite.push-assets.ts). The scope "/" covers /follow. */
export const WORKER_URL = '/push-worker.js';

export type PushState =
  /** Still looking at the browser. The control shows nothing yet. */
  | 'checking'
  /** The browser can't show push notifications. */
  | 'unsupported'
  /** iPhone or iPad in Safari: push works only from a Home Screen web app. */
  | 'ios-install'
  /** The player said no in the browser, so it won't ask again. */
  | 'blocked'
  | 'off'
  | 'on';

/** The state, and words when something went wrong that the player should read. */
export interface PushOutcome {
  state: PushState;
  words: string | null;
}

const TRY_AGAIN = "Couldn't turn on lock screen alerts. Try again.";

/** The base64url a server key and a subscription use, as the bytes `subscribe` wants (RFC 4648 section 5). */
export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when the subscription was made with this key. A different key means the server's changed. */
export function sameKey(subscription: Pick<PushSubscription, 'options'>, key: Uint8Array): boolean {
  const used = subscription.options.applicationServerKey;
  if (!used) return false;
  const bytes = new Uint8Array(used);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

/**
 * iPhone and iPad. iPadOS 13 and later sends a Mac's user agent, so a "Mac" with a touch
 * screen is an iPad. This is the common check; no standard names it.
 */
function isIos(): boolean {
  const nav = globalThis.navigator;
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/**
 * Running as a Home Screen app. `navigator.standalone` is Safari's own flag
 * (https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html);
 * the display-mode query is the standard one
 * (https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/display-mode).
 */
function isStandalone(): boolean {
  const standalone = (globalThis.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || (globalThis.matchMedia?.('(display-mode: standalone)').matches ?? false);
}

/**
 * Whether this browser can do push, from its own APIs. Push needs a secure context, a service
 * worker, `PushManager`, and `Notification` (https://www.w3.org/TR/push-api/). iPhone and iPad
 * have `PushManager` only inside a Home Screen web app, iOS 16.4 and later
 * (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), so there its
 * absence means "add it to the Home Screen", not "can't".
 */
export function pushSupport(): 'ok' | 'ios-install' | 'unsupported' {
  const ok =
    globalThis.isSecureContext === true &&
    typeof globalThis.navigator !== 'undefined' &&
    'serviceWorker' in globalThis.navigator &&
    typeof globalThis.PushManager !== 'undefined' &&
    typeof globalThis.Notification !== 'undefined';
  if (ok) return 'ok';
  return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
}

/** Registers the worker (once; the browser keeps one registration) and waits until it is active. */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(WORKER_URL, { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** The subscription this browser holds for the server, or null. Looks only; registers nothing. */
async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** The subscription as the server's PUT takes it, or null when the browser left a field out. */
function subscriptionBody(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.['p256dh'] || !keys['auth']) return null;
  return { endpoint, keys: { p256dh: keys['p256dh'], auth: keys['auth'] } };
}

/** Sends the subscription to the server. Null on success, else the words for the failure. */
async function save(subscription: PushSubscription): Promise<string | null> {
  const body = subscriptionBody(subscription);
  if (!body) return TRY_AGAIN;
  const result = await savePushSubscription(body);
  return result.ok ? null : failureWords(result);
}

/**
 * Where this browser stands when the control first shows. An existing subscription is sent to
 * the server again, so the server has it after a database reset or a new sign-in; a failure
 * there is left for the next page load. A subscription made with another key (the server's key
 * changed) is replaced when the permission is already given, which needs no tap.
 */
export async function startState(publicKey: string): Promise<PushState> {
  const support = pushSupport();
  if (support !== 'ok') return support;
  if (Notification.permission === 'denied') return 'blocked';
  try {
    let subscription = await existingSubscription();
    if (subscription && Notification.permission === 'granted') {
      const key = urlBase64ToBytes(publicKey);
      if (!sameKey(subscription, key)) {
        await subscription.unsubscribe();
        subscription = await (await readyRegistration()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await save(subscription);
      return 'on';
    }
  } catch {
    // The browser refused to look or to subscribe; the player can try the button.
  }
  return 'off';
}

/**
 * Asks for permission, subscribes, and tells the server. It has to run from a tap: iPhone only
 * shows the permission question after one, and other browsers may ignore a question asked
 * without one, so nothing is awaited before `requestPermission`.
 */
export async function turnOn(publicKey: string): Promise<PushOutcome> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { state: 'blocked', words: null };
  if (permission !== 'granted') return { state: 'off', words: null };
  let subscription: PushSubscription | null = null;
  try {
    const registration = await readyRegistration();
    const key = urlBase64ToBytes(publicKey);
    subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch {
    return { state: 'off', words: TRY_AGAIN };
  }
  const words = await save(subscription);
  if (words === null) return { state: 'on', words: null };
  // The server doesn't have it, so no alert would come: leave the browser unsubscribed too.
  await subscription.unsubscribe().catch(() => undefined);
  return { state: 'off', words };
}

/**
 * Drops this browser's subscription. It looks at the registration that is there and never
 * makes one, and never throws. Used on sign-out, where the server has already deleted its row.
 */
export async function unsubscribeLocal(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    await (await existingSubscription())?.unsubscribe();
  } catch {
    // Nothing to drop, or the browser said no. Either way the phone is signed out.
  }
}

/** Turns alerts off: the browser's subscription first, then the server's. */
export async function turnOff(): Promise<PushOutcome> {
  await unsubscribeLocal();
  // A failed DELETE leaves a row for a dead endpoint, and the push service's 404 or 410 removes it.
  await removePushSubscription();
  return { state: 'off', words: null };
}

