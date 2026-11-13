// The address a request really came from, for the online rate limits (CLAUDE.md, rule 6;
// docs/PLAN.md, section 8). The caller sets X-Forwarded-For, and a reverse proxy only appends
// the address it saw. So the header is read only when the direct peer is the proxy we were
// told about, and only its last entry counts: the one our own proxy wrote. The first entry
// is whatever the caller claimed.

import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/** "::ffff:10.0.0.1" and "10.0.0.1" are the same address; compare and key them alike. */
export function normalizeIp(address: string): string {
  return address.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
}

/** The socket's peer address, normalized. This is the one address a caller can't choose. */
export function getPeerIp(request: FastifyRequest): string {
  return normalizeIp(request.raw.socket.remoteAddress ?? '');
}

/** True when the direct peer is the reverse proxy we were told about. */
export function isFromTrustedProxy(request: FastifyRequest, trustedProxy: string | undefined): boolean {
  return trustedProxy !== undefined && getPeerIp(request) === normalizeIp(trustedProxy);
}

export function getClientIp(request: FastifyRequest, trustedProxy: string | undefined): string {
  const peer = getPeerIp(request);
  if (!isFromTrustedProxy(request, trustedProxy)) return peer;

  const header = request.headers['x-forwarded-for'];
  const value = Array.isArray(header) ? header.join(',') : header;
  const last = value?.split(',').at(-1)?.trim() ?? '';
  // A missing or malformed entry falls back to the proxy's own address. Everyone then shares
  // one bucket, which is the safe way to fail.
  return isIP(last) === 0 ? peer : normalizeIp(last);
}

/** The 8 groups of an IPv6 address as numbers, or undefined when it can't be read as one. */
function ipv6Groups(address: string): number[] | undefined {
  // A scope id ("fe80::1%eth0") isn't part of the address.
  let text = (address.split('%', 1)[0] ?? '').toLowerCase();
  // A dotted IPv4 tail ("::ffff:1.2.3.4", "64:ff9b::1.2.3.4") is the last two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string | undefined) => (part ? part.split(':') : []);
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((g) => parseInt(g, 16));
  return groups.some((g) => !(g >= 0 && g <= 0xffff)) ? undefined : groups;
}

/**
 * The key the per-client limits count under. An IPv4 address is its own key. An IPv6 address
 * is keyed by its /64, because one subscriber controls at least a /64 and can send from any
 * address in it, so a limit per full address would hand out fresh tries without end. RFC 6177
 * (https://www.rfc-editor.org/rfc/rfc6177) says an end site gets "at least one /64, and in
 * most cases significantly more", so a subscriber with a larger range can still move between
 * /64s; that is the limit of this rule. Every per-client limit takes its key from here. The
 * localhost check does not: it reads the socket's own address.
 */
export function getClientKey(request: FastifyRequest, trustedProxy: string | undefined): string {
  const ip = getClientIp(request, trustedProxy);
  const groups = isIP(ip.split('%', 1)[0] ?? '') === 6 ? ipv6Groups(ip) : undefined;
  if (groups === undefined) return ip;
  // ::ffff:a.b.c.d written in hex is still an IPv4 client.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join('.');
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}
