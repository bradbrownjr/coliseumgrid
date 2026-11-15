// The current event: the newest row of the `events` table. M2 created it, M3 let the host name
// it, and M7 adds its game, its plan, and new events (docs/PLAN.md, "Devices and host API" and
// "The setup wizard").

import { EVENT_NAME_MAX, isEventPlan, type EventInfo, type EventPlan } from '@coliseumgrid/core';
import { iso, type Clock } from './clock.ts';
import type { Database } from './database.ts';

/**
 * The name of an event that a sign-up or a bracket made before the host named one. It is what
 * the Display already shows when there is no event, so nothing on screen changes.
 */
export const DEFAULT_EVENT_NAME = 'ColiseumGrid';

/**
 * Collapses runs of whitespace and trims. Returns null when the name is empty, too long, or has
 * a control character (those can't be typed by accident, and one in a TV's title is a trick).
 */
export function cleanEventName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length === 0 || name.length > EVENT_NAME_MAX) return null;
  if (/[\p{Cc}\p{Cf}]/u.test(name)) return null;
  return name;
}

/**
 * The game name, cleaned like the event name and with the same limits. An empty one is valid
 * and means no game, so it gives `''` where a bad one gives null. It is host typed event data
 * and is not run through the handle filter (docs/PLAN.md, "The setup wizard").
 */
export function cleanGameName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length === 0) return '';
  return cleanEventName(name);
}

export interface Events {
  current(): EventInfo | null;
  /** The current event's row id, or null before one exists. */
  currentId(): number | null;
  /**
   * The current event's id, making an event named DEFAULT_EVENT_NAME if there is none, so a
   * player who signs up before the host names the event still belongs to it.
   */
  ensureCurrent(): { id: number; event: EventInfo; created: boolean };
  /**
   * Renames the current event, or creates the first one. `game` left undefined keeps the
   * stored game; an empty string clears it.
   */
  setName(name: string, game?: string): EventInfo;
  /**
   * Makes a new event the current one, copying the current event's plan as its defaults. The
   * game is not copied. An empty `game` is stored as none.
   */
  create(name: string, game?: string): EventInfo;
  /** The current event's plan, or null when it has none, the event doesn't exist, or the stored plan can't be read. */
  plan(): EventPlan | null;
  /** Stores the plan on the current event, making one named DEFAULT_EVENT_NAME if there is none. */
  setPlan(plan: EventPlan): { created: boolean; event: EventInfo };
}

/** A stored plan that isn't JSON, or doesn't pass `isEventPlan`, is as good as none, so a hand-edited database can't break the page. */
function readPlan(raw: unknown): EventPlan | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isEventPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createEvents(db: Database, now: Clock): Events {
  const newest = db.prepare('SELECT id, name, game, plan FROM events ORDER BY id DESC LIMIT 1');
  const rename = db.prepare('UPDATE events SET name = ? WHERE id = ?');
  const renameAndGame = db.prepare('UPDATE events SET name = ?, game = ? WHERE id = ?');
  const insert = db.prepare('INSERT INTO events (name, game, plan, created_at) VALUES (?, ?, ?, ?)');
  const storePlan = db.prepare('UPDATE events SET plan = ? WHERE id = ?');

  const idOf = (): number | null => {
    const row = newest.get();
    return row ? (row['id'] as number) : null;
  };
  const infoOf = (row: Record<string, unknown>): EventInfo => ({ name: row['name'] as string, game: (row['game'] as string | null) ?? null });
  /** An empty game is stored as null. */
  const gameValue = (game: string | undefined): string | null => (game === undefined || game === '' ? null : game);

  const events: Events = {
    currentId: idOf,
    ensureCurrent() {
      const row = newest.get();
      if (row) return { id: row['id'] as number, event: infoOf(row), created: false };
      const result = insert.run(DEFAULT_EVENT_NAME, null, null, iso(now()));
      return { id: Number(result.lastInsertRowid), event: { name: DEFAULT_EVENT_NAME, game: null }, created: true };
    },
    current() {
      const row = newest.get();
      return row ? infoOf(row) : null;
    },
    setName(name, game) {
      const row = newest.get();
      if (!row) {
        insert.run(name, gameValue(game), null, iso(now()));
        return { name, game: gameValue(game) };
      }
      if (game === undefined) {
        rename.run(name, row['id'] as number);
        return { name, game: infoOf(row).game };
      }
      renameAndGame.run(name, gameValue(game), row['id'] as number);
      return { name, game: gameValue(game) };
    },
    create(name, game) {
      const plan = events.plan();
      insert.run(name, gameValue(game), plan ? JSON.stringify(plan) : null, iso(now()));
      return { name, game: gameValue(game) };
    },
    plan() {
      const row = newest.get();
      return row ? readPlan(row['plan']) : null;
    },
    setPlan(plan) {
      const { id, event, created } = events.ensureCurrent();
      storePlan.run(JSON.stringify(plan), id);
      return { created, event };
    },
  };
  return events;
}
