// The current event: the newest row of the `events` table (M2 created it; M7's wizard will
// add more). In M3 the host only names it, for the Display frame (docs/PLAN.md, "Host
// sign-in", "The event name").

import type { EventInfo } from '@coliseumgrid/core';
import { iso, type Clock } from './clock.ts';
import type { Database } from './database.ts';

export const EVENT_NAME_MAX = 60;

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

export interface Events {
  current(): EventInfo | null;
  /** The current event's row id, or null before one exists. */
  currentId(): number | null;
  /**
   * The current event's id, making an event named DEFAULT_EVENT_NAME if there is none, so a
   * player who signs up before the host names the event still belongs to it.
   */
  ensureCurrent(): { id: number; event: EventInfo; created: boolean };
  /** Renames the current event, or creates the first one. */
  setName(name: string): EventInfo;
}

export function createEvents(db: Database, now: Clock): Events {
  const newest = db.prepare('SELECT id, name FROM events ORDER BY id DESC LIMIT 1');
  const rename = db.prepare('UPDATE events SET name = ? WHERE id = ?');
  const insert = db.prepare('INSERT INTO events (name, created_at) VALUES (?, ?)');

  const idOf = (): number | null => {
    const row = newest.get();
    return row ? (row['id'] as number) : null;
  };

  return {
    currentId: idOf,
    ensureCurrent() {
      const row = newest.get();
      if (row) return { id: row['id'] as number, event: { name: row['name'] as string }, created: false };
      const result = insert.run(DEFAULT_EVENT_NAME, iso(now()));
      return { id: Number(result.lastInsertRowid), event: { name: DEFAULT_EVENT_NAME }, created: true };
    },
    current() {
      const row = newest.get();
      return row ? { name: row['name'] as string } : null;
    },
    setName(name) {
      const row = newest.get();
      if (row) rename.run(name, row['id'] as number);
      else insert.run(name, iso(now()));
      return { name };
    },
  };
}
