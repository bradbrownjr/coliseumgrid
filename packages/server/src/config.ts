// Server settings, read from the environment once at startup (docs/DEVELOPMENT.md,
// "Server settings"). An unknown value fails fast instead of falling back to a default.

export const MODES = ['offline', 'online'] as const;
export type Mode = (typeof MODES)[number];

export interface Config {
  /** Offline runs on the host's laptop; online runs behind a reverse proxy (docs/PLAN.md, section 8). */
  mode: Mode;
  host: string;
  port: number;
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

  return { mode, host: env['HOST'] || '0.0.0.0', port };
}
