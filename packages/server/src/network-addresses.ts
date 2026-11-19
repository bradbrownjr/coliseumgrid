// The laptop's addresses on the venue network, for the join address on the host screen
// (docs/PLAN.md, "Pairing a device"). The launcher opens the host screen at localhost, which a
// TV can't reach, so the server names the addresses another screen can use instead.

import { createSocket } from 'node:dgram';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/** What `os.networkInterfaces()` returns: interface name to its addresses. */
export type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** Where the addresses come from. Tests pass stand-ins. */
export interface NetworkSource {
  interfaces: () => Interfaces;
  /** The laptop's own address on the default route, or undefined when there is none. */
  defaultRoute: () => Promise<string | undefined>;
}

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/**
 * The private IPv4 ranges of RFC 1918, section 3 (https://www.rfc-editor.org/rfc/rfc1918#section-3):
 * 10/8, 172.16/12, and 192.168/16. A venue's router hands out one of these. 100.64/10 (shared
 * address space, RFC 6598, which Tailscale uses) is left out, because a TV on the venue network
 * can't reach it, and so is 169.254/16 (link-local, an interface that got no address).
 */
export function isPrivateIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets === null) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The private IPv4 addresses another screen could open, from `interfaces`: no loopback
 * (`internal`), no IPv6, each once. `bound` is the address the server listens on: when it is a
 * single address rather than every address (0.0.0.0 or ::), only that one can work. `preferred`
 * (the default route's address) goes first when it is in the list; the rest keep interface order.
 */
export function privateAddresses(interfaces: Interfaces, bound: string, preferred?: string): string[] {
  const found: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIpv4(entry.address)) continue;
      if (!found.includes(entry.address)) found.push(entry.address);
    }
  }
  const listening = bound === '0.0.0.0' || bound === '::' ? found : found.filter((address) => address === bound);
  if (preferred === undefined || !listening.includes(preferred)) return listening;
  return [preferred, ...listening.filter((address) => address !== preferred)];
}

// RFC 5737 TEST-NET-1 (https://www.rfc-editor.org/rfc/rfc5737#section-3): an address no real
// host has, outside every private range, so the system routes it the way it routes the internet.
const OUTSIDE_ADDRESS = '192.0.2.1';
const OUTSIDE_PORT = 9;

/**
 * The local address the system would send from to reach the internet, which is the laptop's
 * address on its main network. A UDP `connect` sends nothing: it only records the default peer,
 * and the system picks the local address by its routing table. Node: "For a UDP socket
 * connect(2) only records the default peer address and is a local, non-blocking system call"
 * (https://nodejs.org/api/dgram.html#socketconnectsyncport-address). Windows: for a SOCK_DGRAM
 * socket, connect "is merely to establish a default destination address"
 * (https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-connect), and
 * getsockname gives the local address once the socket is connected
 * (https://learn.microsoft.com/en-us/windows/win32/api/winsock/nf-winsock-getsockname). With no
 * default route the connect fails and the answer is undefined, so the list keeps interface order.
 */
export function defaultRouteAddress(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let done = false;
    const finish = (address: string | undefined) => {
      // Closing twice throws, and a failed connect could report through both paths.
      if (done) return;
      done = true;
      socket.close();
      resolve(address);
    };
    socket.on('error', () => finish(undefined));
    socket.connect(OUTSIDE_PORT, OUTSIDE_ADDRESS, (error?: Error) => {
      if (error) return finish(undefined);
      try {
        finish(socket.address().address);
      } catch {
        finish(undefined);
      }
    });
  });
}

export const systemNetwork: NetworkSource = { interfaces: networkInterfaces, defaultRoute: defaultRouteAddress };
