// The current event: the newest row of the `events` table (M2 created it; M7's wizard will
// add more). In M3 the host only names it, for the Display frame (docs/PLAN.md, "Host
// sign-in", "The event name").

import type { EventInfo } from '@coliseumgrid/core';
import { iso, type Clock } from './clock.ts';
import type { Database } from './database.ts';

export const EVENT_NAME_MAX = 60;

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
  /** Renames the current event, or creates the first one. */
  setName(name: string): EventInfo;
}

export function createEvents(db: Database, now: Clock): Events {
  const newest = db.prepare('SELECT id, name FROM events ORDER BY id DESC LIMIT 1');
  const rename = db.prepare('UPDATE events SET name = ? WHERE id = ?');
  const insert = db.prepare('INSERT INTO events (name, created_at) VALUES (?, ?)');

  return {
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
