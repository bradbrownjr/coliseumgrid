// The offline launcher's decisions, kept free of side effects so they can be tested
// (launcher.ts does the work). The design is docs/PLAN.md section 8, "Offline: portable bundle".

import { posix, win32 } from 'node:path';

/** The first port the launcher tries, and how many after it. */
export const FIRST_PORT = 3000;
export const PORT_COUNT = 10;

export function candidatePorts(first = FIRST_PORT, count = PORT_COUNT): number[] {
  return Array.from({ length: count }, (_, i) => first + i);
}

/**
 * The data folder, outside the bundle so a newer bundle unzipped over or beside the old one
 * keeps every event (Brad, 2026-11-18): %LOCALAPPDATA%\ColiseumGrid on Windows and
 * ~/.coliseumgrid elsewhere. LOCALAPPDATA is set by Windows for every user; the fallback is
 * its usual place under the profile, for a shell that dropped it.
 */
export function dataDirFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA'] || win32.join(home, 'AppData', 'Local');
    return win32.join(local, 'ColiseumGrid');
  }
  return posix.join(home, '.coliseumgrid');
}

/** What a port was found to hold: this app, nothing, or another program. */
export type PortState = 'coliseumgrid' | 'free' | 'busy';

export type LaunchPlan =
  | { action: 'open'; port: number }
  | { action: 'start'; port: number; skipped: number[] }
  | { action: 'none' };

/**
 * A ColiseumGrid already running on any of the ports wins, so a second launch opens it
 * instead of starting another server with its own view of the same database. Otherwise the
 * first free port, and the busy ones before it, so the launcher can say why it moved.
 */
export function planLaunch(probes: readonly { port: number; state: PortState }[]): LaunchPlan {
  const running = probes.find((p) => p.state === 'coliseumgrid');
  if (running) return { action: 'open', port: running.port };
  const index = probes.findIndex((p) => p.state === 'free');
  if (index === -1) return { action: 'none' };
  return {
    action: 'start',
    port: (probes[index] as { port: number }).port,
    skipped: probes.slice(0, index).map((p) => p.port),
  };
}

/** True for the answer of ColiseumGrid's GET /api/health, false for anything else. */
export function isColiseumGridHealth(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const record = body as Record<string, unknown>;
  return record['status'] === 'ok' && record['app'] === 'coliseumgrid';
}

/**
 * The command that opens a page in the default browser.
 * - Windows: cmd's built-in `start`, whose first quoted argument is the window title, so an
 *   empty title comes before the address
 *   (https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/start).
 *   Node passes the empty string as "" (libuv's quote_cmd_arg quotes an empty argument). /d
 *   skips cmd's AutoRun commands
 *   (https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd).
 * - Linux: xdg-open, which opens a URL in the user's preferred application
 *   (https://portland.freedesktop.org/doc/xdg-open.html).
 */
export function browserCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

export function hostUrl(port: number): string {
  return `http://localhost:${port}/host`;
}
