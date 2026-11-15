import { planDefaults, type EventPlan, type PlanNowAnswer } from '@coliseumgrid/core';
import { describe, expect, it } from 'vitest';
import type { Result } from '../src/api/request.ts';
import { createPlanSaves } from '../src/pages/host/planSaves.ts';

const plan = (stations: number): EventPlan => ({ ...planDefaults('fighting'), stations });

/** A send whose answers are released by hand, so a test decides the order things finish in. */
function manualSend() {
  const sent: number[] = [];
  const waiting: Array<(result: Result<PlanNowAnswer>) => void> = [];
  const send = (next: EventPlan) => {
    sent.push(next.stations);
    return new Promise<Result<PlanNowAnswer>>((resolve) => waiting.push(resolve));
  };
  const answer = (index: number, ok = true) => {
    const next = sent[index] as number;
    waiting[index]?.(ok ? { ok: true, data: { plan: plan(next) } } : { ok: false, error: 'server-error' });
  };
  return { send, sent, answer };
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the wizard saves', () => {
  it('send the second plan only after the first was answered, and the server keeps the last', async () => {
    const { send, sent, answer } = manualSend();
    const saved: number[] = [];
    const saves = createPlanSaves(send, (p) => saved.push(p.stations), () => undefined);
    const first = saves.save(plan(2));
    const second = saves.save(plan(3));
    await turn();
    expect(sent).toEqual([2]);
    expect(saves.pending()).toBe(2);
    answer(0);
    await first;
    await turn();
    expect(sent).toEqual([2, 3]);
    answer(1);
    expect(await second).toBe(true);
    expect(saved).toEqual([2, 3]);
    expect(saves.pending()).toBe(0);
  });

  it('settle only once every queued save was answered', async () => {
    const { send, answer } = manualSend();
    const saves = createPlanSaves(send, () => undefined, () => undefined);
    void saves.save(plan(2));
    void saves.save(plan(3));
    let settled = false;
    const done = saves.settled().then(() => {
      settled = true;
    });
    await turn();
    answer(0);
    await turn();
    expect(settled).toBe(false);
    answer(1);
    await done;
    expect(settled).toBe(true);
  });

  it('report a refusal, say false, and go on with the saves behind it', async () => {
    const { send, sent, answer } = manualSend();
    const failures: string[] = [];
    const saved: number[] = [];
    const saves = createPlanSaves(send, (p) => saved.push(p.stations), (failure) => failures.push(failure.error));
    const first = saves.save(plan(2));
    const second = saves.save(plan(3));
    await turn();
    answer(0, false);
    expect(await first).toBe(false);
    await turn();
    expect(sent).toEqual([2, 3]);
    answer(1);
    expect(await second).toBe(true);
    expect(failures).toEqual(['server-error']);
    expect(saved).toEqual([3]);
  });

  it('go on after a send that threw', async () => {
    let calls = 0;
    const saves = createPlanSaves(
      async (next) => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return { ok: true, data: { plan: next } };
      },
      () => undefined,
      () => undefined,
    );
    await expect(saves.save(plan(2))).rejects.toThrow('boom');
    expect(await saves.save(plan(3))).toBe(true);
    expect(saves.pending()).toBe(0);
  });
});
