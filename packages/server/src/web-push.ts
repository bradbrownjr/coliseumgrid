// The Web Push sender (docs/PLAN.md, section 3, "Push"), on node:crypto and fetch with no
// dependency. Three RFCs make it up:
//
// - RFC 8030 (<https://www.rfc-editor.org/rfc/rfc8030>): the server POSTs the message to the
//   subscription's endpoint with `TTL` (5.2) and `Urgency` (5.3). 201 means accepted (5),
//   202 accepted with a receipt (5.1), 404 an expired subscription (7.3). 410 is "no longer
//   valid" (<https://web.dev/articles/push-notifications-web-push-protocol>) and, from Apple,
//   "The device token has expired" (Apple's page cited at PUSH_HOSTS below).
// - RFC 8291 (<https://www.rfc-editor.org/rfc/rfc8291>) on RFC 8188
//   (<https://www.rfc-editor.org/rfc/rfc8188>): the body is encrypted to the browser's key,
//   so the push service can't read it.
// - RFC 8292 (<https://www.rfc-editor.org/rfc/rfc8292>): `Authorization: vapid t=..., k=...`,
//   a token signed with the server's key (vapid-keys.ts).
//
// Only online over HTTPS (CLAUDE.md, rule 3); the routes decide that, not this file.

import { createECDH, hkdfSync, createCipheriv, randomBytes, sign, type KeyObject } from 'node:crypto';

export interface PushSubscriptionRecord {
  endpoint: string;
  /** The browser's ECDH P-256 public key, uncompressed, base64url (Push API `getKey('p256dh')`). */
  p256dh: string;
  /** The browser's 16-byte authentication secret, base64url (RFC 8291, 3.2). */
  auth: string;
}

export interface VapidConfig {
  /** Uncompressed P-256 point, base64url (vapid-keys.ts). */
  publicKey: string;
  privateKey: KeyObject;
  /** A `mailto:` or `https:` contact for the push service (RFC 8292, 2.1). */
  subject: string;
}

/** `gone` (404 or 410): the subscription no longer works, so the caller deletes it. */
export type PushOutcome = 'sent' | 'gone' | 'failed';

export type Urgency = 'very-low' | 'low' | 'normal' | 'high';

export interface SendPushOptions {
  ttlSeconds?: number;
  urgency?: Urgency;
  fetch?: typeof fetch;
  /** How long to wait for the push service. For tests; the default is 10 seconds. */
  timeoutMs?: number;
}

// docs/PLAN.md, "Push": an alert is about the next game, so it is worthless after 5 minutes,
// and it should wake the phone.
const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_URGENCY: Urgency = 'high';
const DEFAULT_TIMEOUT_MS = 10_000;

// RFC 8292 section 2: `exp` may be at most 24 hours from the request. 12 hours leaves room for
// a clock that is off.
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

// --- Which endpoints the server will POST to -------------------------------------------------
//
// The endpoint comes from a phone, so without this check a signed-in phone could make the
// server send requests to any address, including ones inside the network. Only the push
// services of the browsers players use are allowed. Hosts checked 2026-11-14:
//
// - Apple (Safari, iPhone and iPad): "allow access for https://*.push.apple.com",
//   <https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers>.
// - Google FCM (Chrome, Android): "if the origin is fcm.googleapis.com, it's working",
//   <https://developer.chrome.com/blog/web-push-interop-wins>.
// - Mozilla autopush (Firefox): the production endpoint is https://updates.push.services.mozilla.com/,
//   <https://autopush.readthedocs.io/en/stable/> and the calls in
//   <https://mozilla-services.github.io/autopush-rs/http.html>.
// - Microsoft WNS (Edge on Windows): Edge connects to the Windows Push Notification Service
//   (<https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/forcebuiltinpushmessagingclient>),
//   and a WNS sender must check that the address is on "notify.windows.com" and never push to
//   another domain; the subdomain changes
//   (<https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview>).
const PUSH_HOSTS: readonly string[] = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const PUSH_HOST_SUFFIXES: readonly string[] = ['.push.apple.com', '.notify.windows.com'];

/**
 * True for an `https:` URL on the default port, with no user name or password, whose host is a
 * known push service. A host that isn't on the list (an IP address, `localhost`, or a lookalike
 * such as `fcm.googleapis.com.evil.example`) is refused.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  // The URL parser lowercases the host and drops `:443` for https, so `port` is '' for both
  // "no port" and "443".
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname;
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

// --- Encryption: RFC 8291 on RFC 8188 ---------------------------------------------------------

// RFC 8291 section 4: one record, and a push service need take no more than 4096 bytes, so the
// plaintext is at most 4096 - 86 (header) - 1 (padding delimiter) - 16 (GCM tag) = 3993 bytes.
const RECORD_SIZE = 4096;
export const MAX_PLAINTEXT_BYTES = 3993;

export interface EncryptOptions {
  /** RFC 8188's 16-byte salt. Random unless a test gives one. */
  salt?: Buffer;
  /** The sender's ECDH private key (32 bytes). A new key per message unless a test gives one. */
  senderPrivateKey?: Buffer;
}

/**
 * Encrypts a push message body as `aes128gcm` for the browser that holds `uaPublic` (65-byte
 * uncompressed point) and `authSecret` (16 bytes). Returns the whole body: the RFC 8188 header
 * followed by the one record.
 */
export function encryptPayload(
  plaintext: Buffer,
  uaPublic: Buffer,
  authSecret: Buffer,
  options: EncryptOptions = {},
): Buffer {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`A push message can be at most ${MAX_PLAINTEXT_BYTES} bytes; this one is ${plaintext.length}`);
  }
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('p256dh must be an uncompressed P-256 point');
  if (authSecret.length !== 16) throw new Error('auth must be 16 bytes (RFC 8291, 3.2)');

  const salt = options.salt ?? randomBytes(16);
  const ecdh = createECDH('prime256v1');
  if (options.senderPrivateKey) ecdh.setPrivateKey(options.senderPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // uncompressed by default
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // RFC 8291 section 3.3 and 3.4. hkdfSync is HKDF-Extract then HKDF-Expand (RFC 5869), the
  // two steps the RFC writes out with HMAC.
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  // One record, sequence number 0, so the nonce isn't XORed with anything (RFC 8291, 3.4).
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // RFC 8188 section 2: the last record's padding delimiter is 0x02, here with no padding.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([cipher.update(plaintext), cipher.update(Buffer.from([0x02])), cipher.final(), cipher.getAuthTag()]);

  // RFC 8188 section 2.1: salt (16) | rs (uint32, big-endian) | idlen (1) | keyid. RFC 8291
  // section 4: keyid is the sender's 65-byte public key.
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, record]);
}

// --- VAPID: RFC 8292 --------------------------------------------------------------------------

/**
 * The `Authorization` header for a push to `endpoint`: `vapid t=<JWT>, k=<public key>`
 * (RFC 8292, sections 2 and 3). `nowMs` is for tests.
 */
export function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowMs: number = Date.now()): string {
  if (!/^(mailto:|https:\/\/)/.test(vapid.subject)) {
    throw new Error(`The VAPID subject must be a mailto: or https: address; got "${vapid.subject}"`);
  }
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + JWT_LIFETIME_SECONDS,
    sub: vapid.subject,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(claims)}`;
  // JWS ES256 is the raw 64-byte r || s (RFC 7518, 3.4), not the DER that sign() gives by
  // default; ieee-p1363 is that raw form.
  const signature = sign('sha256', Buffer.from(signingInput), { key: vapid.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${signingInput}.${signature.toString('base64url')}, k=${vapid.publicKey}`;
}

function base64urlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// --- Sending ----------------------------------------------------------------------------------

/**
 * Sends one push message. Returns `failed` without sending for an endpoint that isn't allowed,
 * and for keys that can't be used. Never throws for a network error or a timeout.
 */
export async function sendPush(
  sub: PushSubscriptionRecord,
  payload: string,
  vapid: VapidConfig,
  options: SendPushOptions = {},
): Promise<PushOutcome> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'failed';
  // A bad subject is the server's own mistake, so it throws here instead of being counted as
  // a failed push.
  const authorization = vapidAuthorization(sub.endpoint, vapid);

  let body: Buffer;
  try {
    body = encryptPayload(Buffer.from(payload, 'utf8'), Buffer.from(sub.p256dh, 'base64url'), Buffer.from(sub.auth, 'base64url'));
  } catch {
    return 'failed';
  }

  const doFetch = options.fetch ?? fetch;
  try {
    const response = await doFetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
        Urgency: options.urgency ?? DEFAULT_URGENCY,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: authorization,
      },
      body: new Uint8Array(body),
      // A redirect could point anywhere, including inside the network, so it is an error
      // rather than something to follow.
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    // Nothing in the body is used; cancelling it frees the connection.
    await response.body?.cancel();
    if (response.status === 201 || response.status === 202) return 'sent';
    if (response.status === 404 || response.status === 410) return 'gone';
    return 'failed';
  } catch {
    return 'failed';
  }
}
