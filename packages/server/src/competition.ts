// One competition per event (docs/PLAN.md, "Heats API", "One competition per event"): an event
// runs a bracket or heats, never both. This is the one place that knows both kinds, so the two
// create routes and the merge guard ask the same question and give the same answer.
//
// The rule: a new competition of either kind is refused (409 `bracket-running`) while the
// event's bracket or heats is still being played, and replaces a finished one of either kind.
// Replacing runs in one transaction, so the old competition is never gone without the new one
// being stored.

import { bracketAnswer, type BracketState, type HandleLookup } from './bracket-engine.ts';
import type { BracketStore } from './bracket-store.ts';
import { inTransaction, type Database } from './database.ts';
import { heatsAnswer, type HeatState } from './heat-engine.ts';
import type { HeatStore } from './heat-store.ts';
import type { Players } from './players.ts';

export interface Competition {
  /** Every current handle, read when an answer is made so a rename shows at once. */
  handles(): HandleLookup;
  /** True if the event has a bracket or heats that isn't finished. */
  running(eventId: number, handles: HandleLookup): Promise<boolean>;
  /**
   * Stores a new bracket as the event's competition, replacing a finished bracket or heats.
   * True if heats were removed, so the caller can tell the screens.
   */
  startBracket(eventId: number, state: BracketState): boolean;
  /** Stores new heats as the event's competition, replacing a finished bracket or heats. True if a bracket was removed. */
  startHeats(eventId: number, state: HeatState): boolean;
  /** True if the player is in the event's bracket or heats, running or finished. */
  hasPlayer(eventId: number, playerId: number): boolean;
}

export function createCompetition(db: Database, brackets: BracketStore, heats: HeatStore, players: Players): Competition {
  return {
    handles: () => new Map(players.list().map((p) => [p.id, p.handle])),
    async running(eventId, handles) {
      const bracket = brackets.load(eventId);
      if (bracket && !(await bracketAnswer(bracket, handles)).finished) return true;
      const run = heats.load(eventId);
      return run !== null && !heatsAnswer(run, handles).finished;
    },
    startBracket(eventId, state) {
      return inTransaction(db, () => {
        const removed = heats.remove(eventId);
        brackets.save(eventId, state);
        return removed;
      });
    },
    startHeats(eventId, state) {
      return inTransaction(db, () => {
        const removed = brackets.remove(eventId);
        heats.save(eventId, state);
        return removed;
      });
    },
    hasPlayer: (eventId, playerId) => brackets.hasPlayer(eventId, playerId) || heats.hasPlayer(eventId, playerId),
  };
}
