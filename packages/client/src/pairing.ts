// Pure helpers for pairing screens (docs/PLAN.md, "Pairing a device"): reading the code a person
// types, building the join address, and the words for time. No React in here, so tests can
// call them directly.

import { JOIN_CODE_LENGTH, formatJoinCode, type HostAddressesAnswer } from '@coliseumgrid/core';
import { generate } from 'lean-qr';
import { toSvgPath } from 'lean-qr/extras/svg';

/**
 * What the code field shows for what was typed: capitals, no spaces or dashes, at most six
 * characters, with the dash after the third ("K7M-4QX"). The server reads the code again
 * (`parseJoinCode`), so look-alike letters such as S for 5 still work.
 */
export function tidyCodeInput(raw: string): string {
  const typed = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, JOIN_CODE_LENGTH);
  return typed.length > 3 ? formatJoinCode(typed) : typed;
}

/** localhost and the loopback addresses only work on the machine itself. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/**
 * The addresses another screen can open, from GET /api/host/addresses: "http://10.0.0.5:3000".
 * The server speaks plain HTTP on the venue network; HTTPS is only behind the online proxy,
 * where the list is empty.
 */
export function networkAddresses(answer: HostAddressesAnswer): string[] {
  const { port } = answer;
  return port === null ? [] : answer.addresses.map((address) => `http://${address}:${port}`);
}

/** The address to show from a new list: the one picked before if it is still there, else the first. */
export function keepPick(picked: string, choices: readonly string[]): string {
  return choices.includes(picked) ? picked : (choices[0] ?? picked);
}

/**
 * The address a QR code opens: the join screen with the code filled in. `address` can be typed
 * by hand, so a missing "http://" is added. Returns null when it isn't an address.
 */
export function joinUrl(address: string, code: string): string | null {
  const trimmed = address.trim();
  if (trimmed === '') return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}/?code=${encodeURIComponent(code)}`;
  } catch {
    return null;
  }
}

/**
 * The address the QR code on the Sign-up done screen opens: the player page with the follow
 * code filled in (docs/PLAN.md, "Player view"). Null on `localhost` and the loopback addresses,
 * because a phone can't reach them and the code would only be spent on a dead link.
 */
export function followUrl(location: Pick<Location, 'origin' | 'hostname'>, code: string): string | null {
  return isLoopbackHost(location.hostname) ? null : `${location.origin}/follow?code=${encodeURIComponent(code)}`;
}

/** The address as shown, without the path a person might have typed after it. */
export function shownAddress(address: string): string {
  const url = joinUrl(address, 'x');
  return url === null ? address.trim() : url.slice(0, url.indexOf('/?code='));
}

/** Time left on a code as "9:41". Never below 0:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${String(seconds).padStart(2, '0')}`;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/** "just now", "5 minutes ago", "2 hours ago", for a device's last-seen time (ISO 8601). */
export function lastSeenWords(lastSeen: string, now: number): string {
  const then = Date.parse(lastSeen);
  if (Number.isNaN(then)) return 'not sure';
  const age = now - then;
  if (age < MINUTE_MS) return 'just now';
  if (age < HOUR_MS) return plural(Math.floor(age / MINUTE_MS), 'minute');
  if (age < DAY_MS) return plural(Math.floor(age / HOUR_MS), 'hour');
  return plural(Math.floor(age / DAY_MS), 'day');
}

/** A QR code's modules as one SVG path in module units, plus its side length. */
export function qrPath(text: string): { size: number; path: string } {
  const code = generate(text);
  return { size: code.size, path: toSvgPath(code) };
}
