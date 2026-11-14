// Server settings, read from the environment once at startup (docs/DEVELOPMENT.md,
// "Server settings"). An unknown value fails fast instead of falling back to a default.

import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { HOST_PASSWORD_MAX, HOST_PASSWORD_MIN } from '@coliseumgrid/core';
import { normalizeIp } from './client-ip.ts';

export const MODES = ['offline', 'online'] as const;
export type Mode = (typeof MODES)[number];

// The limits live in core so the client's setup screen shows the same numbers.
export { HOST_PASSWORD_MAX, HOST_PASSWORD_MIN };

export interface Config {
  /** Offline runs on the host's laptop; online runs behind a reverse proxy (docs/PLAN.md, section 8). */
  mode: Mode;
  host: string;
  port: number;
  /** The folder that holds the database (and later uploaded graphics), absolute. */
  dataDir: string;
  /** The reverse proxy's address. Only a request from it may name a client in X-Forwarded-For (CLAUDE.md, rule 6). */
  trustedProxy?: string;
  /** The host password from COLISEUMGRID_HOST_PASSWORD. When set, it is the password and first-run setup is off. Required online. */
  hostPassword?: string;
  /**
   * The contact the push services see in the VAPID token (RFC 8292, section 2.1), a `mailto:` or
   * `https:` URL, from COLISEUMGRID_PUSH_SUBJECT. Without it, push stays off.
   */
  pushSubject?: string;
}

/**
 * True for a VAPID subject: `mailto:` with an address, or an `https:` URL
 * (https://www.rfc-editor.org/rfc/rfc8292#section-2.1). The host can't be `localhost`: Apple's
 * push service may answer 403 BadJwtToken for it
 * (https://github.com/web-push-libs/web-push, "Using VAPID Key for applicationServerKey").
 */
export function isValidPushSubject(subject: string): boolean {
  const local = (host: string): boolean => /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host) || /\.localhost$/i.test(host);
  if (subject.startsWith('mailto:')) {
    const match = /^mailto:[^@\s]+@([^@\s]+)$/.exec(subject);
    return match !== null && !local(match[1] as string);
  }
  try {
    const url = new URL(subject);
    return url.protocol === 'https:' && !local(url.hostname) && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

/** Takes the environment as a parameter so tests don't touch process.env. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const mode = env['COLISEUMGRID_MODE'] ?? 'offline';
  if (!isMode(mode)) {
    throw new Error(`COLISEUMGRID_MODE must be one of ${MODES.join(', ')}; got "${mode}"`);
  }

  const rawPort = env['PORT'] ?? '3000';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port > 65535) {
    throw new Error(`PORT must be a whole number from 0 to 65535; got "${rawPort}"`);
  }

  // Resolved here so a relative value means the same folder wherever it is later used.
  const dataDir = resolve(env['DATA_DIR'] || 'data');

  const rawProxy = env['TRUSTED_PROXY'];
  if (rawProxy && isIP(rawProxy) === 0) {
    throw new Error(`TRUSTED_PROXY must be an IP address; got "${rawProxy}"`);
  }
  const trustedProxy = rawProxy ? normalizeIp(rawProxy) : undefined;

  // The messages never include the value.
  const hostPassword = env['COLISEUMGRID_HOST_PASSWORD'] || undefined;
  if (hostPassword !== undefined && (hostPassword.length < HOST_PASSWORD_MIN || hostPassword.length > HOST_PASSWORD_MAX)) {
    throw new Error(`COLISEUMGRID_HOST_PASSWORD must be ${HOST_PASSWORD_MIN} to ${HOST_PASSWORD_MAX} characters`);
  }
  // Online there is no localhost sign-in and no first-run setup (docs/PLAN.md, "Host sign-in"),
  // so without this the host screens could never be opened.
  if (mode === 'online' && hostPassword === undefined) {
    throw new Error('COLISEUMGRID_HOST_PASSWORD is required when COLISEUMGRID_MODE is online');
  }

  const pushSubject = env['COLISEUMGRID_PUSH_SUBJECT'] || undefined;
  if (pushSubject !== undefined && !isValidPushSubject(pushSubject)) {
    throw new Error(
      'COLISEUMGRID_PUSH_SUBJECT must be a mailto: address or an https: URL, and not localhost ' +
        '(for example mailto:you@example.com)',
    );
  }

  return {
    mode,
    host: env['HOST'] || '0.0.0.0',
    port,
    dataDir,
    ...(trustedProxy && { trustedProxy }),
    ...(hostPassword && { hostPassword }),
    ...(pushSubject && { pushSubject }),
  };
}
