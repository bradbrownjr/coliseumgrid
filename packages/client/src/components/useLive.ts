import type { LiveMessage } from '@coliseumgrid/core';
import { useEffect, useRef } from 'react';
import { liveUrl, parseLiveMessage, reconnectDelay } from '../api/live.ts';
import { getEvent } from '../api/host.ts';

// RFC 6455 section 7.4.1: 1008 is the code the server closes with when a sign-in ended.
const CLOSE_POLICY = 1008;

export interface LiveHandlers {
  /** Every message except `unpaired`, which ends the connection (see onEnded). */
  onMessage: (message: LiveMessage) => void;
  /** Each time the socket opens, the first time too. Messages sent while it was down are lost, so reload what the screen shows. */
  onOpen?: () => void;
  /** The server unpaired this device or ended this sign-in. The hook has stopped reconnecting. */
  onEnded: () => void;
}

/**
 * The one live connection a screen keeps to GET /api/live (docs/PLAN.md, "Live messages"). After
 * a drop it reconnects with a growing wait (`reconnectDelay`). It stops for good on `unpaired`,
 * on a close for a finished sign-in, and when a try that never opened finds the sign-in gone:
 * a browser reports a refused upgrade as an ordinary drop, so GET /api/event tells the two apart.
 */
export function useLive(handlers: LiveHandlers): void {
  // The effect runs once; the latest handlers are read from here, so a new function each render
  // doesn't reconnect.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const end = () => {
      if (stopped) return;
      stopped = true;
      latest.current.onEnded();
    };

    const retry = () => {
      timer = setTimeout(connect, reconnectDelay(failures));
      failures += 1;
    };

    async function afterDrop(opened: boolean, code: number) {
      if (code === CLOSE_POLICY) return end();
      if (!opened) {
        const probe = await getEvent();
        if (stopped) return;
        if (!probe.ok && probe.error === 'not-signed-in') return end();
      }
      retry();
    }

    function connect() {
      if (stopped) return;
      const ws = new WebSocket(liveUrl(window.location));
      socket = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        failures = 0;
        latest.current.onOpen?.();
      };
      ws.onmessage = (event: MessageEvent) => {
        const message = parseLiveMessage(event.data);
        if (message === null) return;
        if (message.type === 'unpaired') return end();
        latest.current.onMessage(message);
      };
      ws.onclose = (event: CloseEvent) => {
        if (stopped || socket !== ws) return;
        void afterDrop(opened, event.code);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);
}
