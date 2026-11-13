// Settings that are allowed but probably a mistake, printed once at startup by main.ts.

import type { Config } from './config.ts';

export function startupWarnings(config: Pick<Config, 'mode' | 'trustedProxy'>): string[] {
  const warnings: string[] = [];
  if (config.mode === 'online' && config.trustedProxy === undefined) {
    warnings.push(
      'Online mode without TRUSTED_PROXY: every visitor arrives from the proxy, so they all share one ' +
        "set of rate limits and a few wrong tries lock everyone out. Set TRUSTED_PROXY to the reverse proxy's IP address.",
    );
  }
  return warnings;
}
