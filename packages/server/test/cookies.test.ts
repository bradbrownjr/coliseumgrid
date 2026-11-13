import { describe, expect, it } from 'vitest';
import { parseCookies, serializeCookie } from '../src/cookies.ts';

describe('parseCookies', () => {
  it('reads several cookies from one header', () => {
    expect([...parseCookies('cg_host=abc; cg_device=def')]).toEqual([
      ['cg_host', ['abc']],
      ['cg_device', ['def']],
    ]);
  });

  it('keeps every value of a repeated name, in the order the browser sent them', () => {
    expect(parseCookies('a=1; b=x; a=2; a=1').get('a')).toEqual(['1', '2', '1']);
  });

  it('keeps an = inside a value, trims spaces, and strips quotes', () => {
    const cookies = parseCookies('  a = x=y ;b="quoted"; c');
    expect(cookies.get('a')).toEqual(['x=y']);
    expect(cookies.get('b')).toEqual(['quoted']);
    expect(cookies.has('c')).toBe(false);
  });

  it('is empty for a missing or empty header', () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies('').size).toBe(0);
  });
});

describe('serializeCookie', () => {
  it('sets Path, Max-Age, HttpOnly, and SameSite=Strict, and Secure only on request', () => {
    expect(serializeCookie('cg_host', 'tok', { maxAgeSeconds: 60, secure: false })).toBe(
      'cg_host=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Strict',
    );
    expect(serializeCookie('cg_host', 'tok', { maxAgeSeconds: 60, secure: true })).toBe(
      'cg_host=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Strict; Secure',
    );
  });

  it('writes Max-Age=0 to delete a cookie', () => {
    expect(serializeCookie('cg_host', 'x', { maxAgeSeconds: 0, secure: false })).toContain('Max-Age=0');
  });

  it.each([['bad name'], ['a;b'], ['']])('refuses the name "%s"', (name) => {
    expect(() => serializeCookie(name, 'v', { maxAgeSeconds: 1, secure: false })).toThrow(TypeError);
  });

  it.each([['a;b'], ['a b'], ['a\r\nSet-Cookie: x=y'], ['é']])('refuses the value "%s"', (value) => {
    expect(() => serializeCookie('n', value, { maxAgeSeconds: 1, secure: false })).toThrow(TypeError);
  });

  it.each([-1, 1.5, Number.NaN])('refuses a Max-Age of %s', (maxAgeSeconds) => {
    expect(() => serializeCookie('n', 'v', { maxAgeSeconds, secure: false })).toThrow(RangeError);
  });

  it('round-trips a token', () => {
    const header = serializeCookie('cg_device', 'Ab-_09', { maxAgeSeconds: 5, secure: false });
    expect(parseCookies(header.split(';')[0]).get('cg_device')).toEqual(['Ab-_09']);
  });
});
