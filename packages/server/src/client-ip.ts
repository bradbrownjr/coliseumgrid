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
