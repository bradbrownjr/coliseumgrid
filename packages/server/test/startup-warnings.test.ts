import { describe, expect, it } from 'vitest';
import { startupWarnings } from '../src/startup-warnings.ts';

describe('startupWarnings', () => {
  it('warns about online mode with no trusted proxy, and says what to set', () => {
    const warnings = startupWarnings({ mode: 'online' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TRUSTED_PROXY');
  });

  it('is quiet online with a proxy, and offline with or without one', () => {
    expect(startupWarnings({ mode: 'online', trustedProxy: '10.0.0.1' })).toEqual([]);
    expect(startupWarnings({ mode: 'offline' })).toEqual([]);
    expect(startupWarnings({ mode: 'offline', trustedProxy: '10.0.0.1' })).toEqual([]);
  });
});
