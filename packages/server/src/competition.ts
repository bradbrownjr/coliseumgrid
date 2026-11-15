// One competition per event (docs/PLAN.md, "Heats API", "One competition per event"): an event
// runs a bracket or heats, never both. This is the one place that knows both kinds, so the two
// create routes and the merge guard ask the same question and give the same answer.
//
// The rule: a new competition of either kind is refused (409 `bracket-running`) while the
// event's bracket or heats is still being played, and replaces a finished one of either kind.
// Replacing runs in one transaction, so the old competition is never gone without the new one
// being stored.
//
// It also keeps the current answer, for the phones (docs/PLAN.md, "Phone API", "The answer
// cache"): a 32-player round robin takes 258 ms to rebuild, and every phone reloads on every
// result. Whatever changes the answer calls `drop`.

import { NO_SHOW_DEFAULT, type Bracket, type Heats } from '@coliseumgrid/core';
import { bracketAnswer, type BracketState, type HandleLookup } from './bracket-engine.ts';
import type { BracketStore } from './bracket-store.ts';
import { inTransaction, type Database } from './database.ts';
import { heatsAnswer, type HeatState } from './heat-engine.ts';
import type { Events } from './events.ts';
import type { HeatStore } from './heat-store.ts';
import type { Players } from './players.ts';

export interface Competition {
  /** Every current handle, read when an answer is made so a rename shows at once. */
  handles(): HandleLookup;
  /**
   * How long a station's wait is before the host is asked about a missing player, from the
   * event's plan, or `NO_SHOW_DEFAULT` when it has none. Read when an answer is made, with
   * the handles, so a plan change shows once the answer is rebuilt.
   */
  noShowMinutes(): number;
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
  /**
   * The current event's bracket or heats answer, or null when it has neither. Built from one
   * snapshot of the database and kept until `drop`, and callers who ask while it is being built
   * share the one build.
   */
  answer(): Promise<Bracket | Heats | null>;
  /**
   * Forgets the kept answer and tells the listeners. Called after every save, start, delete,
   * rename, merge, and event change, and always after the write it follows, in the same tick.
   */
  drop(): void;
  /** Runs `listener` after every `drop`. */
  onDrop(listener: () => void): void;
}

export function createCompetition(
  db: Database,
  brackets: BracketStore,
  heats: HeatStore,
  players: Players,
  events: Pick<Events, 'currentId' | 'plan'>,
  /** Called each time an answer is built, so a test can see whether the kept one was used. */
  onBuild?: () => void,
): Competition {
  let kept: Promise<Bracket | Heats | null> | null = null;
  const listeners: (() => void)[] = [];

  const noShowMinutes = (): number => events.plan()?.noShowMinutes ?? NO_SHOW_DEFAULT;

  /** Reads everything it needs before its first await, so the answer is one moment of the database. */
  async function build(): Promise<Bracket | Heats | null> {
    onBuild?.();
    const eventId = events.currentId();
    if (eventId === null) return null;
    const handles = new Map(players.list().map((p) => [p.id, p.handle]));
    const noShow = noShowMinutes();
    const bracket = brackets.load(eventId);
    if (bracket) return bracketAnswer(bracket, handles, noShow);
    const run = heats.load(eventId);
    return run ? heatsAnswer(run, handles, noShow) : null;
  }

  function drop(): void {
    kept = null;
    for (const listener of listeners) listener();
  }

  return {
    handles: () => new Map(players.list().map((p) => [p.id, p.handle])),
    noShowMinutes,
    async running(eventId, handles) {
      const bracket = brackets.load(eventId);
      if (bracket && !(await bracketAnswer(bracket, handles)).finished) return true;
      const run = heats.load(eventId);
      return run !== null && !heatsAnswer(run, handles).finished;
    },
    startBracket(eventId, state) {
      const removed = inTransaction(db, () => {
        const removed = heats.remove(eventId);
        brackets.save(eventId, state);
        return removed;
      });
      drop();
      return removed;
    },
    startHeats(eventId, state) {
      const removed = inTransaction(db, () => {
        const removed = brackets.remove(eventId);
        heats.save(eventId, state);
        return removed;
      });
      drop();
      return removed;
    },
    hasPlayer: (eventId, playerId) => brackets.hasPlayer(eventId, playerId) || heats.hasPlayer(eventId, playerId),
    answer() {
      if (kept) return kept;
      const building = build();
      kept = building;
      // A build that throws is not kept, so the next phone tries again.
      building.catch(() => {
        if (kept === building) kept = null;
      });
      return building;
    },
    drop,
    onDrop(listener) {
      listeners.push(listener);
    },
  };
}
