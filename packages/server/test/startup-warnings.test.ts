import { describe, expect, it } from 'vitest';
import { startupWarnings } from '../src/startup-warnings.ts';

describe('startupWarnings', () => {
  const subject = 'mailto:host@example.com';

  it('warns about online mode with no trusted proxy, and says what to set', () => {
    const warnings = startupWarnings({ mode: 'online', pushSubject: subject });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TRUSTED_PROXY');
  });

  it('warns that push is off online without COLISEUMGRID_PUSH_SUBJECT, and says what to set', () => {
    const warnings = startupWarnings({ mode: 'online', trustedProxy: '10.0.0.1' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('COLISEUMGRID_PUSH_SUBJECT');
    expect(warnings[0]).toContain('push alerts are off');
    expect(startupWarnings({ mode: 'online' })).toHaveLength(2);
  });

  it('is quiet online with a proxy and a subject, and offline with or without a proxy', () => {
    expect(startupWarnings({ mode: 'online', trustedProxy: '10.0.0.1', pushSubject: subject })).toEqual([]);
    expect(startupWarnings({ mode: 'offline' })).toEqual([]);
    expect(startupWarnings({ mode: 'offline', trustedProxy: '10.0.0.1' })).toEqual([]);
  });
});
