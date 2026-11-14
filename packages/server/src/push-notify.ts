// Web Push for phones (docs/PLAN.md, "Player view", "Push"): whether it is on, the VAPID keys,
// and sending an alert when a followed player is called or comes up next. This is the one file
// that talks to the sender (web-push.ts) and the key file (vapid-keys.ts), so the routes and the
// tests don't depend on how they work.
//
// Push is on only in online mode, with a VAPID subject set (COLISEUMGRID_PUSH_SUBJECT), and the
// routes offer it only to a request that came over HTTPS (CLAUDE.md, rule 3: push is the one
// feature that needs the internet, and nothing else depends on it).
//
// Sending never blocks or fails a write: a competition change only schedules a check, which
// runs after the write, in its own turn, and swallows every error.

import type { KeyObject } from 'node:crypto';
import { newAlert, playerStatus, type AlertSource, type Bracket, type Heats, type Player } from '@coliseumgrid/core';
import type { Competition } from './competition.ts';
import type { Mode } from './config.ts';
import type { PushSubscriptions } from './push-subscriptions.ts';
import { loadOrCreateVapidKeys } from './vapid-keys.ts';
import { isAllowedPushEndpoint, sendPush, type PushOutcome, type PushSubscriptionRecord, type VapidConfig } from './web-push.ts';

export type PushSender = (sub: PushSubscriptionRecord, payload: string, vapid: VapidConfig) => Promise<PushOutcome>;

export interface PushOptions {
  /** The VAPID subject, a `mailto:` or `https:` URL. Without it push is off. */
  subject?: string;
  /** Where the VAPID key file lives (DATA_DIR). */
  dataDir?: string;
  /** Replaces vapid-keys.ts, for tests. */
  loadKeys?: (dataDir: string) => { publicKey: string; privateKey: KeyObject };
  /** Replaces web-push.ts's sender, for tests. */
  send?: PushSender;
}

/** What a phone's service worker receives, as JSON. `station` is set for `called`. */
export interface PushPayload {
  alert: 'called' | 'next';
  handle: string;
  station: number | null;
}

export interface Push {
  /** True when the server is set up for push; each request must still be HTTPS (see the routes). */
  readonly enabled: boolean;
  /** The server's VAPID key pair, loaded on first use. Undefined when push is off or the key can't be read. */
  vapid(): VapidConfig | undefined;
  isAllowedEndpoint(endpoint: string): boolean;
  /** Takes the competition's current statuses as the starting point, so a restart alerts nobody. */
  start(): Promise<void>;
  /** Resolves when no check or send is running or waiting. For tests. */
  idle(): Promise<void>;
}

interface Snapshot {
  /** Which bracket or heats the statuses are of; a new one starts from "nobody is in it". */
  key: string | null;
  statuses: Map<number, AlertSource & { handle: string; station: number | null }>;
}

const NOT_IN: AlertSource = { status: 'not-in', matchId: null };

/** Every player the answer knows: standings are empty until places are decided, so the matches and heats count too. */
function playersOf(answer: Bracket | Heats): Player[] {
  const fromUnits =
    'matches' in answer
      ? answer.matches.flatMap((m) => m.slots.flatMap((s) => (s.player ? [s.player] : [])))
      : answer.heats.flatMap((h) => h.players);
  return [...fromUnits, ...answer.standings.map((row) => row.player)];
}

function snapshotOf(answer: Bracket | Heats | null): Snapshot {
  if (answer === null) return { key: null, statuses: new Map() };
  const statuses: Snapshot['statuses'] = new Map();
  for (const player of playersOf(answer)) {
    if (statuses.has(player.id)) continue;
    const { status, matchId, station } = playerStatus(answer, player.id);
    statuses.set(player.id, { status, matchId, station, handle: player.handle });
  }
  return { key: `${'matches' in answer ? 'bracket' : 'heats'}:${answer.id}`, statuses };
}

export function createPush(
  options: PushOptions & {
    mode: Mode;
    competition: Competition;
    subscriptions: PushSubscriptions;
    /** Logs something the host should know about. */
    warn: (message: string) => void;
  },
): Push {
  const { competition, subscriptions, warn } = options;
  const subject = options.subject;
  const enabled = options.mode === 'online' && subject !== undefined && (options.dataDir !== undefined || options.loadKeys !== undefined);
  const send: PushSender = options.send ?? ((sub, payload, vapid) => sendPush(sub, payload, vapid));
  const loadKeys = options.loadKeys ?? loadOrCreateVapidKeys;

  let keys: VapidConfig | undefined;
  let keysFailed = false;
  function vapid(): VapidConfig | undefined {
    if (!enabled || keysFailed) return undefined;
    if (keys) return keys;
    try {
      const loaded = loadKeys(options.dataDir ?? '');
      keys = { publicKey: loaded.publicKey, privateKey: loaded.privateKey, subject: subject as string };
      return keys;
    } catch (error) {
      // Tried once: a file that can't be read won't fix itself, and a warning on every request would flood the log.
      keysFailed = true;
      warn(`Push is off: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  let last: Snapshot | undefined;
  let checking: Promise<void> | null = null;
  let dirty = false;
  const sends = new Set<Promise<void>>();

  function dispatch(playerId: number, alert: PushPayload['alert'], handle: string, station: number | null): void {
    const config = vapid();
    if (!config) return;
    const payload = JSON.stringify({ alert, handle, station: alert === 'called' ? station : null } satisfies PushPayload);
    for (const stored of subscriptions.forPlayer(playerId)) {
      const sending = (async () => {
        try {
          const outcome = await send({ endpoint: stored.endpoint, p256dh: stored.p256dh, auth: stored.auth }, payload, config);
          // The push service says the subscription is dead; keeping it would only repeat the failure.
          if (outcome === 'gone') subscriptions.removeEndpoint(stored.endpoint);
        } catch (error) {
          warn(`A push could not be sent: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
      sends.add(sending);
      void sending.finally(() => sends.delete(sending));
    }
  }

  async function check(): Promise<void> {
    const next = snapshotOf(await competition.answer());
    const before = last;
    last = next;
    if (!before) return;
    // A new bracket or heats has everyone at "not in it", so the first calls alert.
    const base = before.key === next.key ? before.statuses : new Map<number, AlertSource>();
    for (const [playerId, now] of next.statuses) {
      const alert = newAlert(base.get(playerId) ?? NOT_IN, now);
      if (alert) dispatch(playerId, alert, now.handle, now.station);
    }
  }

  function schedule(): void {
    dirty = true;
    if (checking) return;
    // In its own turn, so the write that called for this has finished and answered first.
    checking = new Promise<void>((resolve) => {
      setImmediate(() => {
        void (async () => {
          try {
            while (dirty) {
              dirty = false;
              await check();
            }
          } catch (error) {
            warn(`Push alerts could not be worked out: ${error instanceof Error ? error.message : String(error)}`);
          }
          checking = null;
          if (dirty) schedule();
          resolve();
        })();
      });
    });
  }

  if (enabled) competition.onDrop(schedule);

  return {
    enabled,
    vapid,
    isAllowedEndpoint: isAllowedPushEndpoint,
    async start() {
      if (!enabled) return;
      try {
        last = snapshotOf(await competition.answer());
      } catch (error) {
        warn(`Push alerts could not start from the current event: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async idle() {
      while (checking || sends.size > 0) await Promise.all([checking, ...sends]);
    },
  };
}
