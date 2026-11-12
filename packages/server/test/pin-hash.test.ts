import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from '../src/pin-hash.ts';
import { secureRandom } from '../src/secure-random.ts';

describe('hashPin and verifyPin', () => {
  it('round-trips a PIN and rejects another', async () => {
    const stored = await hashPin('0042');
    expect(await verifyPin('0042', stored)).toBe(true);
    expect(await verifyPin('0043', stored)).toBe(false);
    expect(await verifyPin('', stored)).toBe(false);
  });

  it('stores a self-describing string that does not contain the PIN', async () => {
    const stored = await hashPin('1234');
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain('1234');
    const salt = Buffer.from(stored.split('$')[4] as string, 'base64');
    expect(salt.length).toBe(16);
  });

  it('uses a new salt each time', async () => {
    const [a, b] = await Promise.all([hashPin('1234'), hashPin('1234')]);
    expect(a).not.toBe(b);
    expect(await verifyPin('1234', a)).toBe(true);
    expect(await verifyPin('1234', b)).toBe(true);
  });

  it('verifies with the parameters written in the string', async () => {
    // Made by hand with N=1024, as if the cost had been changed since.
    const salt = Buffer.from('0123456789abcdef');
    const key = scryptSync('9999', salt, 24, { cost: 1024, blockSize: 8, parallelization: 1 });
    const stored = `scrypt$1024$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    expect(await verifyPin('9999', stored)).toBe(true);
    expect(await verifyPin('9998', stored)).toBe(false);
  });

  it.each([
    '',
    'plain',
    'scrypt$1$2$3',
    'bcrypt$16384$8$1$AAAA$AAAA',
    'scrypt$x$8$1$AAAA$AAAA',
    'scrypt$1000$8$1$AAAA$AAAA',
    'scrypt$16384$8$1$$',
  ])('never matches the damaged string "%s"', async (stored) => {
    expect(await verifyPin('1234', stored)).toBe(false);
  });
});

describe('secureRandom', () => {
  it('stays in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const n = secureRandom();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});
