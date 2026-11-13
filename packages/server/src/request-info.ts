// Two questions about a request that decide how much to trust it: did it come from this very
// machine (the offline "localhost" sign-in), and did it arrive over HTTPS (the Secure cookie
// flag). Both start from the socket, never from a header a caller can write (CLAUDE.md, rule 6).

import type { FastifyRequest } from 'fastify';
import { getPeerIp, isFromTrustedProxy } from './client-ip.ts';
import type { Mode } from './config.ts';

// 127.0.0.1 and ::1; getPeerIp has already turned ::ffff:127.0.0.1 into the first.
const LOOPBACK = new Set(['127.0.0.1', '::1']);
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostnameOf(host: string | undefined): string | undefined {
  if (host === undefined) return undefined;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

/**
 * True when the request is from the host's own laptop and may count as signed in without a
 * password (docs/PLAN.md, "Host sign-in"). Needs all of:
 * - offline mode. Online, a reverse proxy makes every request arrive from localhost (rule 6).
 * - the socket's peer is loopback. No header can grant this.
 *
 * The checks below can only take the sign-in away, so a header a caller writes can't gain
 * anything from them:
 * - no forwarding header. A local reverse proxy would put every remote request on loopback;
 *   one that sets X-Forwarded-For or Forwarded no longer gets the free sign-in.
 * - a Host of localhost, 127.0.0.1, or [::1]. A web page on another site can point its own
 *   name at 127.0.0.1 (DNS rebinding) and then send requests from the host's browser; those
 *   carry the page's name as Host. This also stops a dev server proxy on the laptop (Vite)
 *   from making every LAN request look local, since it passes the original Host through.
 * - an Origin, when the browser sends one, that matches Host. Another site's script posting
 *   to localhost carries its own Origin.
 */
export function isLocalRequest(request: FastifyRequest, mode: Mode): boolean {
  if (mode !== 'offline') return false;
  if (!LOOPBACK.has(getPeerIp(request))) return false;
  const headers = request.headers;
  if (
    headers['x-forwarded-for'] !== undefined ||
    headers['x-forwarded-host'] !== undefined ||
    headers['x-forwarded-proto'] !== undefined ||
    headers['forwarded'] !== undefined
  ) {
    return false;
  }
  const hostname = hostnameOf(headers.host);
  if (hostname === undefined || !LOCAL_NAMES.has(hostname)) return false;
  const origin = headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== new URL(`http://${headers.host}`).host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * True when the browser reached us over HTTPS, so a cookie can carry the Secure flag. The
 * server itself speaks plain HTTP, so the answer comes from the reverse proxy: its
 * X-Forwarded-Proto, and only when the direct peer is the trusted proxy (rule 6). The last
 * entry is the one our own proxy wrote; earlier ones are the caller's. Offline, with no proxy,
 * the answer is false, and a Secure cookie would never be sent back over plain HTTP.
 */
export function isHttps(request: FastifyRequest, trustedProxy: string | undefined): boolean {
  const socket = request.raw.socket as { encrypted?: boolean } | undefined;
  if (socket?.encrypted === true) return true;
  if (!isFromTrustedProxy(request, trustedProxy)) return false;
  const header = request.headers['x-forwarded-proto'];
  const value = Array.isArray(header) ? header.join(',') : header;
  return value?.split(',').at(-1)?.trim().toLowerCase() === 'https';
}

