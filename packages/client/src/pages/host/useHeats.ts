import type { Heats } from '@coliseumgrid/core';
import { getHeats } from '../../api/heats.ts';
import type { Result } from '../../api/request.ts';
import { useSnapshot, type Snapshot } from './useSnapshot.ts';

/** The host screen's groups: undefined while loading, null when none have been made. */
export type HeatsState = Snapshot<Heats>;

const loadHeats = async (): Promise<Result<Heats | null>> => {
  const result = await getHeats();
  return result.ok ? { ok: true, data: result.data.heats } : result;
};

export function useHeats(): HeatsState {
  return useSnapshot(loadHeats);
}
