// When the player page raises an alert, and what the tab title says meanwhile (docs/PLAN.md,
// "Player view"). `newAlert` in `packages/core` decides whether one status change is new; this
// file applies it to every followed player between two answers. No React, so tests call it.

import { newAlert, type AlertSource, type FollowedPlayer } from '@coliseumgrid/core';
import { calledTitle, nextWords } from './phoneWords.ts';

/** A player the host called to a station. `matchId` tells a new call from the one already shown. */
export interface CalledAlert {
  playerId: number;
  handle: string;
  station: number | null;
  matchId: number | null;
  others: string[];
}

/** A player who is first in Up next. */
export interface NextAlert {
  playerId: number;
  handle: string;
}

/** The part of each answer the next answer is compared with, by player id. */
export type AlertMemory = ReadonlyMap<number, AlertSource>;

export interface AlertDecision {
  called: CalledAlert[];
  next: NextAlert[];
  /** Pass this back in with the next answer. */
  memory: AlertMemory;
}

export const rememberStatuses = (following: readonly FollowedPlayer[]): AlertMemory =>
  new Map(following.map((f) => [f.player.id, { status: f.status, matchId: f.matchId }]));

/**
 * The new alerts in `following`, compared with `memory` from the answer before. With no
 * memory (the first load) nothing is new, and neither is a player who wasn't in the memory
 * (just followed): there is nothing earlier to compare with (`newAlert`).
 */
export function decideAlerts(memory: AlertMemory | null, following: readonly FollowedPlayer[]): AlertDecision {
  const called: CalledAlert[] = [];
  const next: NextAlert[] = [];
  for (const f of following) {
    const level = newAlert(memory?.get(f.player.id) ?? null, f);
    if (level === 'called') {
      called.push({ playerId: f.player.id, handle: f.player.handle, station: f.station, matchId: f.matchId, others: f.others.map((o) => o.handle) });
    } else if (level === 'next') {
      next.push({ playerId: f.player.id, handle: f.player.handle });
    }
  }
  return { called, next, memory: rememberStatuses(following) };
}

/**
 * The calls that still apply. A result recorded, or undone, moves the player off the station,
 * and a call for a match they have left is no use.
 */
export function stillCalled(called: readonly CalledAlert[], following: readonly FollowedPlayer[]): CalledAlert[] {
  return called.filter((alert) => following.some((f) => f.player.id === alert.playerId && f.status === 'now' && f.matchId === alert.matchId));
}

/** The banners that still apply: the player is still first in Up next. */
export function stillNext(next: readonly NextAlert[], following: readonly FollowedPlayer[]): NextAlert[] {
  return next.filter((alert) => following.some((f) => f.player.id === alert.playerId && f.status === 'next'));
}

/** Adds `incoming` to `current`, once per player: a newer alert replaces the player's older one. */
export function mergeAlerts<T extends { playerId: number }>(current: readonly T[], incoming: readonly T[]): T[] {
  const ids = new Set(incoming.map((a) => a.playerId));
  return [...current.filter((a) => !ids.has(a.playerId)), ...incoming];
}

/**
 * The tab's title. A call flips it between the call and the page's name, once a second (`flip`
 * alternates), so it shows on a tab that isn't in front. A banner for "next" holds it steady.
 */
export function pageTitle(options: { called: readonly CalledAlert[]; next: readonly NextAlert[]; flip: boolean; base: string }): string {
  const [first] = options.called;
  if (first) return options.flip ? options.base : calledTitle(first.handle, first.station);
  const [soon] = options.next;
  return soon ? nextWords(soon.handle) : options.base;
}

// Sound and buzz ----------------------------------------------------------------------------

/** One beep of the call sound: when it starts and how long it lasts, in seconds, and its pitch. */
export interface Beep {
  at: number;
  length: number;
  hertz: number;
}

/** Three rising beeps. A tone made in the page: nothing is fetched (CLAUDE.md, rule 3). */
export const CALL_BEEPS: readonly Beep[] = [
  { at: 0, length: 0.18, hertz: 784 },
  { at: 0.28, length: 0.18, hertz: 988 },
  { at: 0.56, length: 0.34, hertz: 1319 },
];

/** `navigator.vibrate` pattern in milliseconds: buzz, pause, buzz, pause, buzz. */
export const CALL_VIBRATION = [300, 120, 300, 120, 300] as const;

/** The overlay's pulse: one full cycle a second, under WCAG 2.3.1's limit of three flashes in any one second. */
export const FLASH_SECONDS = 1;
