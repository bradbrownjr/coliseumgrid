import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { isHttps, isLocalRequest } from '../src/request-info.ts';

function request(
  peer: string | undefined,
  headers: Record<string, string | string[]> = {},
  socketExtra: object = {},
): FastifyRequest {
  return { raw: { socket: { remoteAddress: peer, ...socketExtra } }, headers } as unknown as FastifyRequest;
}

describe('isLocalRequest', () => {
  const local = { host: 'localhost:3000' };

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts the peer %s offline', (peer) => {
    expect(isLocalRequest(request(peer, local), 'offline')).toBe(true);
  });

  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'localhost'])('accepts the Host "%s"', (host) => {
    expect(isLocalRequest(request('127.0.0.1', { host }), 'offline')).toBe(true);
  });

  it('is never true online, even from the loopback address', () => {
    expect(isLocalRequest(request('127.0.0.1', local), 'online')).toBe(false);
    expect(isLocalRequest(request('::1', local), 'online')).toBe(false);
  });

  it.each(['192.168.1.5', '10.0.0.1', '127.0.0.2', '::ffff:10.0.0.1', '', undefined])(
    'refuses the peer %s',
    (peer) => {
      expect(isLocalRequest(request(peer, local), 'offline')).toBe(false);
    },
  );

  it('does not let a header make a remote peer local', () => {
    const headers = { host: 'localhost', 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1' };
    expect(isLocalRequest(request('192.168.1.5', headers), 'offline')).toBe(false);
  });

  it('refuses a loopback peer that a proxy forwarded for someone else', () => {
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded']) {
      expect(isLocalRequest(request('127.0.0.1', { ...local, [header]: 'x' }), 'offline'), header).toBe(false);
    }
  });

  it.each(['evil.example.com', '192.168.1.5:3000', 'localhost.evil.com', 'xlocalhost', undefined])(
    'refuses the Host %s (DNS rebinding)',
    (host) => {
      expect(isLocalRequest(request('127.0.0.1', host === undefined ? {} : { host }), 'offline')).toBe(false);
    },
  );

  it('refuses a cross-origin Origin and accepts a matching one', () => {
    expect(isLocalRequest(request('127.0.0.1', { ...local, origin: 'https://evil.example.com' }), 'offline')).toBe(false);
    expect(isLocalRequest(request('127.0.0.1', { ...local, origin: 'null' }), 'offline')).toBe(false);
    expect(isLocalRequest(request('127.0.0.1', { ...local, origin: 'http://localhost:3000' }), 'offline')).toBe(true);
  });
});

describe('isHttps', () => {
  const proxy = '10.0.0.1';

  it('is false with no proxy, whatever the header says', () => {
    expect(isHttps(request('198.51.100.7', { 'x-forwarded-proto': 'https' }), undefined)).toBe(false);
    expect(isHttps(request('198.51.100.7', { 'x-forwarded-proto': 'https' }), proxy)).toBe(false);
  });

  it('is true from the trusted proxy when the last X-Forwarded-Proto entry is https', () => {
    expect(isHttps(request(proxy, { 'x-forwarded-proto': 'https' }), proxy)).toBe(true);
    expect(isHttps(request(`::ffff:${proxy}`, { 'x-forwarded-proto': 'HTTPS' }), proxy)).toBe(true);
  });

  it('reads only the last entry, which is the proxy own', () => {
    expect(isHttps(request(proxy, { 'x-forwarded-proto': 'https, http' }), proxy)).toBe(false);
    expect(isHttps(request(proxy, { 'x-forwarded-proto': 'http, https' }), proxy)).toBe(true);
    expect(isHttps(request(proxy, { 'x-forwarded-proto': ['https', 'http'] }), proxy)).toBe(false);
  });

  it('is false from the proxy when the header is missing', () => {
    expect(isHttps(request(proxy), proxy)).toBe(false);
  });

  it('is true on a TLS socket', () => {
    expect(isHttps(request('198.51.100.7', {}, { encrypted: true }), undefined)).toBe(true);
  });
});
