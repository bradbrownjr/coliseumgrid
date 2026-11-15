// Who signed up to the current event (docs/PLAN.md, "Brackets API", "Who is in a bracket").
// Players are kept across events and attendance isn't tracked, so the start dialog needs this
// list to pre-check the players who are here.

import type { EventInfo } from '@coliseumgrid/core';
import type { Database } from './database.ts';
import type { Events } from './events.ts';

export interface EventPlayers {
  /**
   * Puts the player in the current event, naming one first if the host hasn't (see
   * `Events.ensureCurrent`). True if they weren't in it yet.
   */
  add(playerId: number): boolean;
  /** Player ids in the current event, lowest first; empty before an event exists. */
  list(): number[];
  /** Gives the merged-away player's place in the event to the player kept. */
  move(fromId: number, toId: number): void;
}

/** `onEventCreated` runs when `add` had to make the event, so screens learn its name. */
export function createEventPlayers(
  db: Database,
  events: Events,
  onEventCreated: (event: EventInfo) => void,
): EventPlayers {
  const insert = db.prepare('INSERT OR IGNORE INTO event_players (event_id, player_id) VALUES (?, ?)');
  const list = db.prepare('SELECT player_id FROM event_players WHERE event_id = ? ORDER BY player_id');
  const move = db.prepare('INSERT OR IGNORE INTO event_players (event_id, player_id) SELECT event_id, ? FROM event_players WHERE player_id = ?');

  return {
    add(playerId) {
      const { id, event, created } = events.ensureCurrent();
      const added = insert.run(id, playerId).changes > 0;
      if (created) onEventCreated(event);
      return added;
    },
    list() {
      const id = events.currentId();
      return id === null ? [] : list.all(id).map((row) => row['player_id'] as number);
    },
    move(fromId, toId) {
      // The rows of the merged player go with their deletion (ON DELETE CASCADE).
      move.run(toId, fromId);
    },
  };
}
