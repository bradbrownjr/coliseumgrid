import type { Player } from '@coliseumgrid/core';

/** "Zap", "Zap and Kai", "Zap, Kai, and Blaze". */
export function joinHandles(players: readonly Pick<Player, 'handle'>[]): string {
  const handles = players.map((player) => player.handle);
  if (handles.length <= 2) return handles.join(' and ');
  return `${handles.slice(0, -1).join(', ')}, and ${handles.at(-1)}`;
}
