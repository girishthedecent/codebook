import { setTimeout as sleep } from 'node:timers/promises';

// In-process only: fine for one server. Several instances would each get the full rate.

/** Spaces calls out: each `wait()` resolves at least `intervalMs` after the previous one. */
export function createPacer(intervalMs: number) {
  let next = 0;
  return async function wait() {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + intervalMs;
    if (at > now) await sleep(at - now);
  };
}

/**
 * Allows `limit` units (e.g. texts sent to a model) per sliding `windowMs`. `take` waits
 * until its units fit and serves callers in order; `record` counts units that must not wait.
 */
export function createWindowLimiter(limit: number, windowMs: number) {
  const used: { at: number; count: number }[] = [];
  let queue = Promise.resolve();

  function usedSince(now: number) {
    while (used[0] && used[0].at <= now - windowMs) used.shift();
    return used.reduce((sum, entry) => sum + entry.count, 0);
  }

  async function acquire(count: number) {
    for (;;) {
      const now = Date.now();
      if (usedSince(now) + count <= limit) {
        used.push({ at: now, count });
        return;
      }
      // Wait for the oldest entry to leave the window, then look again.
      await sleep(used[0]!.at + windowMs - now);
    }
  }

  return {
    take(count: number) {
      if (count > limit) throw new Error(`Can't take ${count} at once; the limit is ${limit}`);
      const turn = queue.then(() => acquire(count));
      queue = turn;
      return turn;
    },
    record(count: number) {
      used.push({ at: Date.now(), count });
    },
  };
}
