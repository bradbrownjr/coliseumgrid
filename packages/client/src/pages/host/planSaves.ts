// The wizard's saves of the plan, one after another (docs/PLAN.md, "The setup wizard", "Storage
// and routes"). A change made on step 3 is saved at once, and a second change can come while the
// first is still on its way; sent side by side, the two could reach the server in either order
// and leave the older one stored. Here each save is sent only after the one before it was
// answered, so the plan the server holds is the last change made, and **Start** can wait for
// them all (`settled`) and then start from what the server answered.

import type { EventPlan, PlanNowAnswer } from '@coliseumgrid/core';
import type { Failure } from '../../api/errors.ts';
import type { Result } from '../../api/request.ts';

export interface PlanSaves {
  /** Queues a save. Resolves true when the server took it, false when it refused or didn't answer. */
  save(plan: EventPlan): Promise<boolean>;
  /** Resolves once every save queued so far has been answered. */
  settled(): Promise<void>;
  /** How many saves are queued or on their way. */
  pending(): number;
}

/**
 * `send` makes one save (PUT /api/event/plan). `onSaved` gets the plan the server answered with,
 * and `onFailed` the failure, each in the order the saves were queued.
 */
export function createPlanSaves(
  send: (plan: EventPlan) => Promise<Result<PlanNowAnswer>>,
  onSaved: (plan: EventPlan) => void,
  onFailed: (failure: Failure) => void,
): PlanSaves {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    save(plan) {
      pending += 1;
      const turn = tail.then(async () => {
        try {
          const result = await send(plan);
          if (!result.ok) {
            onFailed(result);
            return false;
          }
          onSaved(result.data.plan);
          return true;
        } finally {
          pending -= 1;
        }
      });
      // A save that threw must not stop the ones behind it.
      tail = turn.catch(() => undefined);
      return turn;
    },
    settled: async () => {
      await tail;
    },
    pending: () => pending,
  };
}
