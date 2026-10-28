import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './concurrency.js';

describe('runWithConcurrency', () => {
  it('keeps at most `limit` calls in flight', async () => {
    let running = 0;
    let most = 0;
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    });
    expect(most).toBe(2);
  });

  it('starts nothing new after a failure and rethrows it once the rest settle', async () => {
    const started: number[] = [];
    const run = runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (item === 1) throw new Error('boom');
    });
    await expect(run).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});
