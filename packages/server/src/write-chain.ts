// One write at a time. The bracket library is asynchronous, so a route that loads a bracket,
// changes it, and saves it has gaps where another request could run, and two taps would each
// save from the same starting point and one result would be lost (docs/PLAN.md, "Brackets
// API"). Every task passed to `run` starts only after the one before it has finished,
// whether that one worked or threw.

export interface WriteChain {
  /** Runs `task` after every task queued before it. Its result or error goes to the caller. */
  run<T>(task: () => T | Promise<T>): Promise<T>;
}

export function createWriteChain(): WriteChain {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(task) {
      const result = tail.then(task);
      // A failed task must not stop the ones behind it, and its error belongs to its own caller.
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
