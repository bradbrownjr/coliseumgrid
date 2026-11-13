import { describe, expect, it } from 'vitest';
import { createWriteChain } from '../src/write-chain.ts';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the write chain', () => {
  it('runs tasks one at a time, in the order they were queued, even when an early one is slow', async () => {
    const chain = createWriteChain();
    const log: string[] = [];
    let running = 0;
    const task = (name: string, ms: number) => async () => {
      running++;
      expect(running).toBe(1);
      log.push(`start ${name}`);
      await pause(ms);
      log.push(`end ${name}`);
      running--;
      return name;
    };
    const results = await Promise.all([chain.run(task('a', 30)), chain.run(task('b', 1)), chain.run(task('c', 10))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('gives a failure to its own caller and still runs the tasks behind it', async () => {
    const chain = createWriteChain();
    const failing = chain.run(async () => {
      await pause(5);
      throw new Error('boom');
    });
    const after = chain.run(() => 'still ran');
    await expect(failing).rejects.toThrow('boom');
    await expect(after).resolves.toBe('still ran');
    await expect(chain.run(() => 'and later')).resolves.toBe('and later');
  });

  it('runs a task that throws at once, not before the one ahead of it has finished', async () => {
    const chain = createWriteChain();
    const log: string[] = [];
    const slow = chain.run(async () => {
      await pause(20);
      log.push('slow done');
    });
    const sync = chain.run(() => {
      log.push('sync ran');
      throw new Error('sync boom');
    });
    await expect(sync).rejects.toThrow('sync boom');
    await slow;
    expect(log).toEqual(['slow done', 'sync ran']);
  });
});
