import type { Bracket } from '@coliseumgrid/core';
import { getBracket } from '../../api/bracket.ts';
import type { Result } from '../../api/request.ts';
import { useSnapshot, type Snapshot } from './useSnapshot.ts';

/** The host screen's bracket: undefined while loading, null when none has been made. */
export type BracketState = Snapshot<Bracket>;

const loadBracket = async (): Promise<Result<Bracket | null>> => {
  const result = await getBracket();
  return result.ok ? { ok: true, data: result.data.bracket } : result;
};

export function useBracket(): BracketState {
  return useSnapshot(loadBracket);
}
