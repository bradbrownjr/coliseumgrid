// Handles (src/handle.ts): the characters and length a handle may have, how it is
// normalized, the comparison key, and the full check that the client and the server share.

import { describe, expect, it } from 'vitest';
import { HANDLE_MAX, HANDLE_MIN, checkHandle, handleKey, normalizeHandle } from '../src/index.ts';

describe('checkHandle', () => {
  it('takes 2 to 16 letters, digits, inner spaces, and . - _', () => {
    const good = ['Zap', 'ZAP', 'zap', 'AB', 'KC1JMH', 'Ace-1', 'R.Type', 'Mr X', 'a_b', '--', 'x99'];
    for (const raw of good) expect(checkHandle(raw), raw).toMatchObject({ ok: true });
  });

  it('shows the handle as typed and keys it in lower case', () => {
    expect(checkHandle('Zap')).toEqual({ ok: true, handle: 'Zap', key: 'zap' });
    expect(checkHandle('ZAP')).toEqual({ ok: true, handle: 'ZAP', key: 'zap' });
    expect(checkHandle('KC1jmh')).toEqual({ ok: true, handle: 'KC1jmh', key: 'kc1jmh' });
  });

  it('takes 16-character handles in any case and turns down 17', () => {
    const sixteen = 'AbCdEfGhIjKlMnOp';
    expect(sixteen).toHaveLength(HANDLE_MAX);
    expect(checkHandle(sixteen)).toEqual({ ok: true, handle: sixteen, key: sixteen.toLowerCase() });
    expect(checkHandle('Sixteen Chars Ok')).toMatchObject({ ok: true });
    expect(checkHandle('A'.repeat(16))).toMatchObject({ ok: true });
    expect(checkHandle('A'.repeat(17))).toEqual({ ok: false, reason: 'too-long' });
    expect(checkHandle('Seventeen chars 17')).toEqual({ ok: false, reason: 'too-long' });
  });

  it('turns down handles that are too short', () => {
    expect(HANDLE_MIN).toBe(2);
    for (const raw of ['', ' ', '   ', 'A', ' A ', 'a  ']) {
      expect(checkHandle(raw), JSON.stringify(raw)).toEqual({ ok: false, reason: 'too-short' });
    }
  });

  it('turns down characters outside letters, digits, space, and . - _', () => {
    const bad = ['Br@d', 'Brad!', 'Bräd', 'Ünal', 'a\tb', 'a\nb', 'a b', 'Zap\n', '\u{1F600}\u{1F600}', 'a,b', 'ab/cd', 'Бrad', 'ａｂ'];
    for (const raw of bad) expect(checkHandle(raw), JSON.stringify(raw)).toEqual({ ok: false, reason: 'bad-characters' });
  });

  it('reports characters before length', () => {
    expect(checkHandle('@')).toEqual({ ok: false, reason: 'bad-characters' });
    expect(checkHandle('@'.repeat(40))).toEqual({ ok: false, reason: 'bad-characters' });
  });

  it('measures length after trimming and collapsing spaces', () => {
    expect(checkHandle('   AB   ')).toMatchObject({ ok: true, handle: 'AB' });
    expect(checkHandle('A' + ' '.repeat(10) + 'B')).toMatchObject({ ok: true, handle: 'A B' });
    expect(checkHandle(' ' + 'A'.repeat(16) + ' ')).toMatchObject({ ok: true });
    expect(checkHandle('A'.repeat(8) + '    ' + 'B'.repeat(8))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('refuses vulgar handles in any case, with the code "not-allowed"', () => {
    for (const raw of ['FUCK', 'fuck', 'Fuck', 'fUcK', 'A.S.S', 'a s s', 'Sh1t', 'Big Ass', 'BigDumbass', 'F  U  C  K', 'Wh0re_x']) {
      expect(checkHandle(raw), raw).toEqual({ ok: false, reason: 'not-allowed' });
    }
  });

  it('passes innocent handles in any case', () => {
    for (const raw of ['Cutlass', 'CLASS', 'peacock', 'Hancock', 'Dickens', 'Title', 'Scunthor', 'Push It', 'Nigel', 'R2D2', 'Class_Act', 'Passwords Rule']) {
      expect(checkHandle(raw), raw).toMatchObject({ ok: true });
    }
  });

  it('filters the normalized handle, so edge spaces do not hide a word', () => {
    expect(checkHandle('Ass ')).toEqual({ ok: false, reason: 'not-allowed' });
  });
});

describe('normalizeHandle', () => {
  it('trims the ends and collapses runs of spaces, nothing else', () => {
    expect(normalizeHandle('  Zap  Zap ')).toBe('Zap Zap');
    expect(normalizeHandle('A   B   C')).toBe('A B C');
    expect(normalizeHandle('A.  .B')).toBe('A. .B');
    expect(normalizeHandle('Zap')).toBe('Zap');
    expect(normalizeHandle('   ')).toBe('');
    expect(normalizeHandle('\tZap')).toBe('\tZap');
  });
});

describe('handleKey', () => {
  it('is the same for handles that differ only in case or edge spaces', () => {
    expect(handleKey('Zap')).toBe('zap');
    expect(handleKey('ZAP')).toBe(handleKey('Zap'));
    expect(handleKey(' zAp ')).toBe(handleKey('Zap'));
    expect(handleKey('Mr   X')).toBe(handleKey('mr x'));
  });

  it('differs for different handles', () => {
    expect(handleKey('Z4P')).not.toBe(handleKey('Zap'));
    expect(handleKey('Z.A.P')).not.toBe(handleKey('Zap'));
    expect(handleKey('Mr X')).not.toBe(handleKey('MrX'));
    expect(handleKey('a_b')).not.toBe(handleKey('a b'));
  });

  it('matches the key checkHandle returns', () => {
    for (const raw of ['Zap', ' ZAP ', 'Mr   X', 'KC1jmh']) {
      const result = checkHandle(raw);
      expect(result.ok && result.key).toBe(handleKey(raw));
    }
  });
});
