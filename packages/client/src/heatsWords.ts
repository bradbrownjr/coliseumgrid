// What the groups' standings and tie notice say, for the host screen and the Display alike, so
// both read the same (docs/PLAN.md, "Races and free-for-all", "Ties"). Pure functions of a Heats
// answer, with no React.

import type { Heats, TieNotice } from '@coliseumgrid/core';
import { joinHandles } from './handles.ts';

/**
 * How many rows sit above the cut line: the places that reach the final. Null when everyone
 * reaches it (2 to 4 players) or there are no rows, so no line is drawn.
 */
export const cutAfter = (rowCount: number, finalSize: number): number | null =>
  finalSize > 0 && finalSize < rowCount ? finalSize : null;

/** The row index of the first player in an open tie at the cut, or -1 when no tie is open. */
function firstTiedIndex(heats: Heats): number {
  const tied = new Set(heats.ties.flatMap((tie) => tie.players.map((player) => player.id)));
  return heats.standings.findIndex((row) => tied.has(row.player.id));
}

/**
 * Where the cut line goes. With a tie open at the cut it goes above the whole tied group, so
 * it never reads as the tied players being in: only the rows above it are surely through.
 */
export function heatCutAfter(heats: Heats): number | null {
  const first = firstTiedIndex(heats);
  if (first >= 0 && first < heats.finalSize) return first;
  return cutAfter(heats.standings.length, heats.finalSize);
}

/** Before any qualifying group has a result, every player is level, so there are no places to show. */
export const noResultsYet = (heats: Heats): boolean =>
  heats.standings.length > 0 && heats.standings.every((row) => row.heatsPlayed === 0);

/**
 * The one line a tie at the cut shows, worded by what is at stake: "Zap, Jett, Dash, and Jinx
 * are tied. 2 of them go to the final. Tie-break race coming up." The spots are the places the
 * final has left after the players surely in (docs/PLAN.md, "Ties").
 */
export function heatTieMessage(tie: TieNotice, heats: Heats): string {
  const tail = tie.started ? 'Playing the tie-break race.' : 'Tie-break race coming up.';
  const tied = tie.players.map((player) => player.id);
  const first = heats.standings.findIndex((row) => tied.includes(row.player.id));
  const spots = heats.finalSize - first;
  const spotsText = first >= 0 && spots >= 1 && spots < tie.players.length ? ` ${spots} of them ${spots === 1 ? 'goes' : 'go'} to the final.` : '';
  return `${joinHandles(tie.players)} are tied.${spotsText} ${tail}`;
}
