import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { getClientIp, getClientKey, normalizeIp } from '../src/client-ip.ts';

function request(peer: string | undefined, headers: Record<string, string | string[]> = {}): FastifyRequest {
  return { raw: { socket: { remoteAddress: peer } }, headers } as unknown as FastifyRequest;
}

describe('getClientIp', () => {
  const proxy = '10.0.0.1';

  it('uses the socket address when no proxy is trusted, whatever the header says', () => {
    expect(getClientIp(request('198.51.100.7', { 'x-forwarded-for': '1.2.3.4' }), undefined)).toBe('198.51.100.7');
  });

  it('ignores the header from any peer but the trusted proxy', () => {
    expect(getClientIp(request('198.51.100.7', { 'x-forwarded-for': '1.2.3.4' }), proxy)).toBe('198.51.100.7');
  });

  it('takes the last entry from the trusted proxy, never the first', () => {
    const headers = { 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.9' };
    expect(getClientIp(request(proxy, headers), proxy)).toBe('203.0.113.9');
  });

  it('takes the last entry when the header arrives as several lines', () => {
    expect(getClientIp(request(proxy, { 'x-forwarded-for': ['6.6.6.6', '203.0.113.9'] }), proxy)).toBe('203.0.113.9');
  });

  it('matches the proxy whether the socket reports it as IPv4 or IPv4-mapped IPv6', () => {
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    expect(getClientIp(request('::ffff:10.0.0.1', headers), proxy)).toBe('203.0.113.9');
    expect(getClientIp(request(proxy, headers), '::ffff:10.0.0.1')).toBe('203.0.113.9');
  });

  it('falls back to the proxy address when the header is missing or its last entry is not an IP', () => {
    expect(getClientIp(request(proxy), proxy)).toBe(proxy);
    expect(getClientIp(request(proxy, { 'x-forwarded-for': '1.2.3.4, not-an-ip' }), proxy)).toBe(proxy);
    expect(getClientIp(request(proxy, { 'x-forwarded-for': '' }), proxy)).toBe(proxy);
  });

  it('copes with a missing socket address', () => {
    expect(getClientIp(request(undefined), undefined)).toBe('');
  });
});

describe('normalizeIp', () => {
  it('drops the IPv4-mapped prefix and lower-cases', () => {
    expect(normalizeIp('::FFFF:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
  });
});

describe('getClientKey', () => {
  const key = (peer: string, headers: Record<string, string> = {}, proxy?: string) => getClientKey(request(peer, headers), proxy);

  it('keeps an IPv4 address whole, and an IPv4-mapped IPv6 address as the IPv4 one', () => {
    expect(key('198.51.100.7')).toBe('198.51.100.7');
    expect(key('::ffff:198.51.100.7')).toBe('198.51.100.7');
  });

  it('reads an IPv4-mapped address in hex form as the IPv4 one', () => {
    expect(key('::ffff:c633:6407')).toBe('198.51.100.7');
  });

  it('keys an IPv6 address by its /64, however the address is written', () => {
    const range = '2001:db8:1:2::/64';
    expect(key('2001:db8:1:2::1')).toBe(range);
    expect(key('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe(range);
    expect(key('2001:db8:1:2:0:0:0:0')).toBe(range);
    expect(key('2001:db8:1:2:aaaa:bbbb:1.2.3.4')).toBe(range);
    expect(key('2001:db8:1:3::1')).not.toBe(range);
  });

  it('handles :: at the start, the middle, and a scope id', () => {
    expect(key('::1')).toBe('0:0:0:0::/64');
    expect(key('2001:db8::5')).toBe('2001:db8:0:0::/64');
    expect(key('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('uses the proxy-reported client, by the same rule', () => {
    expect(key('10.0.0.1', { 'x-forwarded-for': '6.6.6.6, 2001:db8:1:2::9' }, '10.0.0.1')).toBe('2001:db8:1:2::/64');
  });

  it('copes with a missing socket address', () => {
    expect(getClientKey(request(undefined), undefined)).toBe('');
  });
});
