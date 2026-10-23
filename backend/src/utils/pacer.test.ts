import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPacer, createWindowLimiter } from './pacer.js';

// Fake timers replace the global setTimeout but not node:timers/promises, so route the
// pacer's sleep through the global one.
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

// Records when each promise resolves, in fake milliseconds.
function track(promises: Promise<void>[]) {
  const times: number[] = [];
  promises.forEach((promise, i) => void promise.then(() => (times[i] = Date.now())));
  return times;
}

describe('createPacer', () => {
  it('lets the first call through and spaces the rest', async () => {
    const wait = createPacer(1_000);
    const times = track([wait(), wait(), wait()]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(times).toEqual([0, 1_000, 2_000]);
  });

  it("doesn't wait after a quiet spell", async () => {
    const wait = createPacer(1_000);
    await wait();
    await vi.advanceTimersByTimeAsync(3_000);
    const times = track([wait()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(times).toEqual([3_000]);
  });
});

describe('createWindowLimiter', () => {
  it('waits until older units leave the window', async () => {
    const limiter = createWindowLimiter(80, 60_000);
    const times = track([limiter.take(40), limiter.take(40), limiter.take(40)]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(times).toEqual([0, 0, 60_000]);
  });

  it('serves callers in order, so a small take does not jump a waiting big one', async () => {
    const limiter = createWindowLimiter(80, 60_000);
    const times = track([limiter.take(60), limiter.take(40), limiter.take(10)]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(times).toEqual([0, 60_000, 60_000]);
  });

  it('counts recorded units without waiting for them', async () => {
    const limiter = createWindowLimiter(80, 60_000);
    limiter.record(50);
    const times = track([limiter.take(40)]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(times).toEqual([60_000]);
  });

  it('refuses a take that could never fit', () => {
    const limiter = createWindowLimiter(80, 60_000);
    expect(() => limiter.take(81)).toThrow(/limit is 80/);
  });
});
