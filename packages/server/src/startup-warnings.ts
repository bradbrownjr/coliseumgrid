// Settings that are allowed but probably a mistake, printed once at startup by main.ts.

import type { Config } from './config.ts';

export function startupWarnings(config: Pick<Config, 'mode' | 'trustedProxy' | 'pushSubject'>): string[] {
  const warnings: string[] = [];
  if (config.mode === 'online' && config.trustedProxy === undefined) {
    warnings.push(
      'Online mode without TRUSTED_PROXY: every visitor arrives from the proxy, so they all share one ' +
        "set of rate limits and a few wrong tries lock everyone out. Set TRUSTED_PROXY to the reverse proxy's IP address.",
    );
  }
  // Push needs HTTPS and a subject for the push services; without the subject, only the page
  // alert works (docs/PLAN.md, "Player view").
  if (config.mode === 'online' && config.pushSubject === undefined) {
    warnings.push(
      'Online mode without COLISEUMGRID_PUSH_SUBJECT: push alerts are off, and phones get the page alert only. ' +
        'Set it to a mailto: address or an https: URL for the push services to reach you, for example mailto:you@example.com.',
    );
  }
  return warnings;
}
