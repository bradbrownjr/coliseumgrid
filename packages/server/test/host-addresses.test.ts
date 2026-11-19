// GET /api/host/addresses and the address filter behind it, with a stand-in for the system's
// network interfaces. The route reads the port from the listening server, so the route tests
// listen on port 0 (any free port).

import type { NetworkInterfaceInfo } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { defaultRouteAddress, isPrivateIpv4, privateAddresses, type Interfaces, type NetworkSource } from '../src/network-addresses.ts';
import { HOST_PASSWORD, pairDevice, REMOTE, signInHost, withCookie } from './helpers.ts';

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` };
}

function v6(address: string): NetworkInterfaceInfo {
  return { address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/64`, scopeid: 0 };
}

const LAPTOP: Interfaces = {
  lo: [v4('127.0.0.1', true), v6('::1')],
  // A virtual adapter (a VM host network, say) listed before the Wi-Fi.
  vboxnet0: [v4('192.168.56.1')],
  wlan0: [v4('10.0.0.5'), v6('fe80::1')],
  tailscale0: [v4('100.101.102.103')],
  eth1: [v4('169.254.10.20')],
};

describe('isPrivateIpv4', () => {
  it.each(['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.255.255'])('accepts %s', (address) => {
    expect(isPrivateIpv4(address)).toBe(true);
  });

  it.each([
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '11.0.0.1',
    '100.64.0.1',
    '169.254.1.1',
    '127.0.0.1',
    '8.8.8.8',
    '::1',
    'fd00::1',
    '10.0.0',
    '10.0.0.256',
    '',
  ])('refuses %s', (address) => {
    expect(isPrivateIpv4(address)).toBe(false);
  });
});

describe('privateAddresses', () => {
  it('keeps private IPv4 addresses in interface order, and drops loopback, IPv6, CGNAT, and link-local', () => {
    expect(privateAddresses(LAPTOP, '0.0.0.0')).toEqual(['192.168.56.1', '10.0.0.5']);
  });

  it('puts the default route address first', () => {
    expect(privateAddresses(LAPTOP, '0.0.0.0', '10.0.0.5')).toEqual(['10.0.0.5', '192.168.56.1']);
  });

  it('ignores a default route address that is not in the list', () => {
    expect(privateAddresses(LAPTOP, '0.0.0.0', '100.101.102.103')).toEqual(['192.168.56.1', '10.0.0.5']);
  });

  it('lists every address for a server on all IPv6 addresses too', () => {
    expect(privateAddresses(LAPTOP, '::')).toEqual(['192.168.56.1', '10.0.0.5']);
  });

  it('keeps only the address a server listens on, and none for loopback', () => {
    expect(privateAddresses(LAPTOP, '10.0.0.5', '192.168.56.1')).toEqual(['10.0.0.5']);
    expect(privateAddresses(LAPTOP, '127.0.0.1')).toEqual([]);
  });

  it('lists an address held by two interfaces once', () => {
    expect(privateAddresses({ a: [v4('10.0.0.5')], b: [v4('10.0.0.5')], c: undefined }, '0.0.0.0')).toEqual(['10.0.0.5']);
  });
});

describe('defaultRouteAddress', () => {
  // The real system's answer: an address on a machine with a default route, undefined on one without.
  it('resolves to an IPv4 address or undefined, and never throws', async () => {
    const address = await defaultRouteAddress();
    if (address !== undefined) expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });
});

describe('GET /api/host/addresses', () => {
  let app: FastifyInstance | undefined;
  let routeAsked = 0;
  const fake: NetworkSource = {
    interfaces: () => LAPTOP,
    defaultRoute: async () => {
      routeAsked += 1;
      return '10.0.0.5';
    },
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
    routeAsked = 0;
  });

  async function start(options: AppOptions = {}, host = '0.0.0.0'): Promise<{ server: FastifyInstance; port: number }> {
    app = await buildApp({ hostPassword: HOST_PASSWORD, network: fake, ...options });
    await app.listen({ host, port: 0 });
    const bound = app.server.address();
    if (bound === null || typeof bound === 'string') throw new Error('not listening');
    return { server: app, port: bound.port };
  }

  it('gives the host every private address, the default route first, and the port, field by field', async () => {
    const { server, port } = await start();
    const host = await signInHost(server);
    const res = await withCookie(server, host, { url: '/api/host/addresses' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ addresses: ['10.0.0.5', '192.168.56.1'], port }));
  });

  it('answers the laptop itself, offline, with no cookie', async () => {
    const { server, port } = await start();
    const res = await server.inject({ url: '/api/host/addresses', remoteAddress: '127.0.0.1' });
    expect(res.json()).toEqual({ addresses: ['10.0.0.5', '192.168.56.1'], port });
  });

  it('refuses a stranger, a Display, a Sign-up device, and a phone-only browser with 401', async () => {
    const { server } = await start();
    const host = await signInHost(server);
    const display = await pairDevice(server, host, 'display');
    const signup = await pairDevice(server, host, 'signup');
    for (const cookie of [undefined, display.cookie, signup.cookie, 'cg_phone=garbage']) {
      const res = await server.inject({ url: '/api/host/addresses', remoteAddress: REMOTE, ...(cookie && { headers: { cookie } }) });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'not-signed-in' });
    }
    expect(routeAsked).toBe(0);
  });

  it('is empty online, and never looks at the network', async () => {
    const { server } = await start({ mode: 'online' });
    const host = await signInHost(server);
    const res = await withCookie(server, host, { url: '/api/host/addresses' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"addresses":[],"port":null}');
    expect(routeAsked).toBe(0);
  });

  it('is empty when the server listens on loopback only, which no other screen can reach', async () => {
    const { server } = await start({}, '127.0.0.1');
    const res = await server.inject({ url: '/api/host/addresses', remoteAddress: '127.0.0.1' });
    expect(res.json()).toEqual({ addresses: [], port: null });
  });

  it('is empty when the laptop has no private address', async () => {
    const { server } = await start({ network: { interfaces: () => ({ lo: [v4('127.0.0.1', true)] }), defaultRoute: async () => undefined } });
    const res = await server.inject({ url: '/api/host/addresses', remoteAddress: '127.0.0.1' });
    expect(res.json()).toEqual({ addresses: [], port: null });
  });
});
