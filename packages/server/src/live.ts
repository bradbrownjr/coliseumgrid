// The live connections behind GET /api/live (docs/PLAN.md, "Live messages"): who is connected,
// sending them messages, dropping the ones whose sign-in ended, and a heartbeat that finds
// connections that died without saying so.

import type { LiveMessage } from '@coliseumgrid/core';

/**
 * How often every connection is pinged. A phone or TV that loses Wi-Fi never sends a close, so
 * without this its socket would stay in the set forever. 30 seconds is half of nginx's default
 * proxy_read_timeout of 60 seconds
 * (https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout), so the ping
 * also keeps an idle connection open through a reverse proxy like it. A dead connection is
 * dropped at the second tick, so within a minute.
 */
export const HEARTBEAT_MS = 30 * 1000;

// WebSocket.readyState OPEN (https://websockets.spec.whatwg.org/#dom-websocket-readystate).
const OPEN = 1;
// RFC 6455 section 7.4.1: 1000 is a normal close, 1008 a policy violation (the sign-in ended).
const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 1008;

/**
 * How long a closing connection gets to finish before it is cut. A client that has stopped
 * reading never completes a send and never answers a close frame, and ws itself waits 30
 * seconds for that answer, so without this a removed device's socket could stay open.
 */
export const CLOSE_GRACE_MS = 2000;

/** The part of a ws WebSocket the hub uses, so tests can stand in for one. */
export interface LiveSocket {
  readonly readyState: number;
  send(data: string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: 'pong' | 'close', listener: () => void): unknown;
}

export interface LiveConnectionInfo {
  /** Set for a paired device, so unpairing it closes this connection. */
  deviceId?: number;
  /** Set for a phone, so signing it out closes this connection. */
  phoneId?: number;
  /** Set for a cookie host session, so signing out closes this connection. */
  sessionHash?: string;
  /** Asked at each heartbeat. False closes the connection (the session expired, or the device is gone). */
  stillAllowed: () => boolean;
}

export interface LiveHub {
  attach(socket: LiveSocket, info: LiveConnectionInfo): void;
  /** Sends the message to every connection. */
  broadcast(message: LiveMessage): void;
  /** Tells the device's connections they are unpaired, then closes them. */
  unpair(deviceId: number): void;
  /** Tells the phone's connections they are signed out (`unpaired`), then closes them. */
  signOutPhone(phoneId: number): void;
  /** Closes the connections that signed in with this session. */
  endSession(sessionHash: string): void;
  /** Stops the heartbeat. Open sockets are closed by the WebSocket plugin on app close. */
  stop(): void;
}

interface Connection extends LiveConnectionInfo {
  socket: LiveSocket;
  alive: boolean;
}

/** Cuts the connection if it is still open once the grace period is over. */
function terminateSoon(socket: LiveSocket): void {
  const timer = setTimeout(() => socket.terminate(), CLOSE_GRACE_MS);
  // A pending cut must not keep the process alive after the app closes.
  timer.unref();
  socket.on('close', () => clearTimeout(timer));
}

function closeSocket(socket: LiveSocket, code: number, reason: string): void {
  socket.close(code, reason);
  terminateSoon(socket);
}

function sendJson(socket: LiveSocket, message: LiveMessage, then?: () => void): void {
  if (socket.readyState !== OPEN) return;
  socket.send(JSON.stringify(message), then && (() => then()));
}

export function createLiveHub(heartbeatMs: number = HEARTBEAT_MS): LiveHub {
  const connections = new Set<Connection>();

  const timer = setInterval(() => {
    for (const connection of connections) {
      const { socket } = connection;
      if (!connection.alive) {
        // It never answered the last ping.
        connections.delete(connection);
        socket.terminate();
      } else if (!connection.stillAllowed()) {
        connections.delete(connection);
        closeSocket(socket, CLOSE_POLICY, 'not-signed-in');
      } else {
        connection.alive = false;
        socket.ping();
      }
    }
  }, heartbeatMs);
  // A pending heartbeat must not keep the process alive after the app closes.
  timer.unref();

  /** Sends `unpaired` to the matching connections, then closes them. */
  function sendUnpaired(matches: (connection: Connection) => boolean): void {
    for (const connection of connections) {
      if (!matches(connection)) continue;
      connections.delete(connection);
      // Close after the message is written, or the client could see only the close.
      const { socket } = connection;
      if (socket.readyState !== OPEN) continue;
      sendJson(socket, { type: 'unpaired' }, () => socket.close(CLOSE_NORMAL));
      // The send's callback never runs for a client that isn't reading, so the cut doesn't wait for it.
      terminateSoon(socket);
    }
  }

  return {
    attach(socket, info) {
      const connection: Connection = { ...info, socket, alive: true };
      connections.add(connection);
      socket.on('pong', () => {
        connection.alive = true;
      });
      socket.on('close', () => {
        connections.delete(connection);
      });
    },
    broadcast(message) {
      for (const { socket } of connections) sendJson(socket, message);
    },
    unpair: (deviceId) => sendUnpaired((connection) => connection.deviceId === deviceId),
    signOutPhone: (phoneId) => sendUnpaired((connection) => connection.phoneId === phoneId),
    endSession(sessionHash) {
      for (const connection of connections) {
        if (connection.sessionHash !== sessionHash) continue;
        connections.delete(connection);
        closeSocket(connection.socket, CLOSE_POLICY, 'not-signed-in');
      }
    },
    stop: () => clearInterval(timer),
  };
}
