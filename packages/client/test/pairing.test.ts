import { parseJoinCode } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import {
  followUrl,
  formatCountdown,
  isLoopbackHost,
  joinUrl,
  keepPick,
  lastSeenWords,
  networkAddresses,
  qrPath,
  shownAddress,
  tidyCodeInput,
} from '../src/pairing.ts';

describe('code entry', () => {
  it('shows capitals with the dash after the third character', () => {
    expect(tidyCodeInput('k7m4qx')).toBe('K7M-4QX');
    expect(tidyCodeInput('k7m')).toBe('K7M');
    expect(tidyCodeInput('k7m4')).toBe('K7M-4');
  });

  it('takes the code with a dash, spaces, or both, in any case', () => {
    for (const typed of ['K7M-4QX', 'k7m-4qx', 'K7M 4QX', ' k7m - 4qx ', 'K7M4QX']) {
      expect(tidyCodeInput(typed)).toBe('K7M-4QX');
    }
  });

  it('stops at six characters', () => {
    expect(tidyCodeInput('K7M4QXAAAA')).toBe('K7M-4QX');
  });

  it('drops a dash that has nothing after it, so backspace works', () => {
    expect(tidyCodeInput('K7M-')).toBe('K7M');
  });

  it('keeps look-alike letters for the shared reader, which maps them', () => {
    // S, Z, B, and U are not in the alphabet but parseJoinCode reads them as 5, 2, 8, and V.
    expect(tidyCodeInput('s2b-uc3')).toBe('S2B-UC3');
    expect(parseJoinCode(tidyCodeInput('s2b-uc3'))).toBe('528VC3');
  });

  it('produces text the shared reader accepts', () => {
    expect(parseJoinCode(tidyCodeInput('  k7m 4qx'))).toBe('K7M4QX');
  });

  it('leaves characters the reader refuses, so the screen can say the code is wrong', () => {
    expect(parseJoinCode(tidyCodeInput('k7m-0qx'))).toBeNull();
    expect(parseJoinCode(tidyCodeInput('k7m'))).toBeNull();
  });
});

describe('join address', () => {
  it('puts the code in the address', () => {
    expect(joinUrl('http://10.0.0.5:8080', 'K7M4QX')).toBe('http://10.0.0.5:8080/?code=K7M4QX');
    expect(joinUrl('https://play.example.com', 'K7M4QX')).toBe('https://play.example.com/?code=K7M4QX');
  });

  it('adds http:// when a typed address has none, and drops a path', () => {
    expect(joinUrl('192.168.1.20:3000', 'K7M4QX')).toBe('http://192.168.1.20:3000/?code=K7M4QX');
    expect(joinUrl(' http://10.0.0.5:8080/host ', 'K7M4QX')).toBe('http://10.0.0.5:8080/?code=K7M4QX');
  });

  it('refuses things that are not addresses', () => {
    expect(joinUrl('', 'K7M4QX')).toBeNull();
    expect(joinUrl('   ', 'K7M4QX')).toBeNull();
    expect(joinUrl('javascript://x', 'K7M4QX')).toBeNull();
    expect(joinUrl('not an address', 'K7M4QX')).toBeNull();
  });

  it('shows the address without the path', () => {
    expect(shownAddress('http://10.0.0.5:8080/host')).toBe('http://10.0.0.5:8080');
    expect(shownAddress('192.168.1.20:3000')).toBe('http://192.168.1.20:3000');
    expect(shownAddress('nonsense words')).toBe('nonsense words');
  });

  it('knows the addresses that only work on the laptop', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['10.0.0.5', 'play.example.com', 'localhost.example.com']) expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('words for time', () => {
  it('counts down as minutes and seconds', () => {
    expect(formatCountdown(10 * 60 * 1000)).toBe('10:00');
    expect(formatCountdown(9 * 60 * 1000 + 41_000)).toBe('9:41');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(500)).toBe('0:01');
  });

  it('stops at zero', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5000)).toBe('0:00');
  });

  it('says when a device was last seen', () => {
    const now = Date.parse('2026-07-10T18:00:00Z');
    const ago = (ms: number) => lastSeenWords(new Date(now - ms).toISOString(), now);
    expect(ago(20_000)).toBe('just now');
    expect(ago(60_000)).toBe('1 minute ago');
    expect(ago(5 * 60_000)).toBe('5 minutes ago');
    expect(ago(60 * 60_000)).toBe('1 hour ago');
    expect(ago(3 * 60 * 60_000)).toBe('3 hours ago');
    expect(ago(2 * 24 * 60 * 60_000)).toBe('2 days ago');
    expect(ago(-5000)).toBe('just now');
    expect(lastSeenWords('yesterday', now)).toBe('not sure');
  });
});

describe('QR code', () => {
  it('draws the join address as an SVG path', () => {
    const { size, path } = qrPath('http://10.0.0.5:8080/?code=K7M4QX');
    // Version 1 is 21 modules wide and each version adds 4 (ISO/IEC 18004).
    expect((size - 17) % 4).toBe(0);
    expect(size).toBeGreaterThanOrEqual(21);
    expect(path).toMatch(/^M\d+ \d+/);
  });
});

describe('the follow address', () => {
  it('opens the player page with the code', () => {
    expect(followUrl({ origin: 'http://10.6.26.20:8080', hostname: '10.6.26.20' }, 'K7M4QX')).toBe('http://10.6.26.20:8080/follow?code=K7M4QX');
    expect(followUrl({ origin: 'https://grid.example.org', hostname: 'grid.example.org' }, 'K7M4QX')).toBe('https://grid.example.org/follow?code=K7M4QX');
  });

  it('uses the laptop\'s first network address on the machine itself', () => {
    const [first] = networkAddresses({ addresses: ['10.0.0.5', '192.168.56.1'], port: 3000 });
    expect(followUrl({ origin: 'http://localhost:3000', hostname: 'localhost' }, 'K7M4QX', first as string)).toBe('http://10.0.0.5:3000/follow?code=K7M4QX');
    expect(followUrl({ origin: 'http://127.0.0.1:3000', hostname: '127.0.0.1' }, 'K7M4QX', first as string)).toBe('http://10.0.0.5:3000/follow?code=K7M4QX');
  });

  it('keeps the page\'s own address off the machine itself, whatever the laptop address', () => {
    expect(followUrl({ origin: 'http://10.6.26.20:8080', hostname: '10.6.26.20' }, 'K7M4QX', 'http://10.0.0.5:3000')).toBe('http://10.6.26.20:8080/follow?code=K7M4QX');
  });

  it('is null on the machine itself with no laptop address, where a phone cannot follow it', () => {
    expect(followUrl({ origin: 'http://localhost:3000', hostname: 'localhost' }, 'K7M4QX')).toBeNull();
    expect(followUrl({ origin: 'http://[::1]:3000', hostname: '[::1]' }, 'K7M4QX')).toBeNull();
  });
});

describe('the laptop\'s network addresses', () => {
  it('turns the server\'s answer into addresses a screen can open, in its order', () => {
    expect(networkAddresses({ addresses: ['10.0.0.5', '192.168.56.1'], port: 3000 })).toEqual(['http://10.0.0.5:3000', 'http://192.168.56.1:3000']);
  });

  it('is empty when the server names none (online)', () => {
    expect(networkAddresses({ addresses: [], port: null })).toEqual([]);
  });

  it('gives addresses the join URL and the shown address accept', () => {
    const [first] = networkAddresses({ addresses: ['10.0.0.5'], port: 8080 });
    expect(joinUrl(first as string, 'K7M4QX')).toBe('http://10.0.0.5:8080/?code=K7M4QX');
    expect(shownAddress(first as string)).toBe('http://10.0.0.5:8080');
  });

  it('keeps the address picked before while the list still has it, else takes the first', () => {
    const choices = ['http://10.0.0.5:3000', 'http://192.168.56.1:3000'];
    expect(keepPick('http://192.168.56.1:3000', choices)).toBe('http://192.168.56.1:3000');
    expect(keepPick('http://localhost:3000', choices)).toBe('http://10.0.0.5:3000');
    expect(keepPick('http://localhost:3000', [])).toBe('http://localhost:3000');
  });
});
