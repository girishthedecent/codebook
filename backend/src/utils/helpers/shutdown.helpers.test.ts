import { describe, expect, it, vi } from 'vitest';
import { createShutdownRegistry } from './shutdown.helpers.js';

describe('shutdown registry', () => {
  it('runs hooks in registration order', async () => {
    const registry = createShutdownRegistry();
    const calls: string[] = [];
    registry.register(async () => void calls.push('first'));
    registry.register(async () => void calls.push('second'));

    expect(await registry.run()).toBe(true);
    expect(calls).toEqual(['first', 'second']);
  });

  it('keeps going after a hook fails and reports the failure', async () => {
    const registry = createShutdownRegistry();
    const later = vi.fn().mockResolvedValue(undefined);
    registry.register(() => Promise.reject(new Error('disconnect failed')));
    registry.register(later);

    expect(await registry.run()).toBe(false);
    expect(later).toHaveBeenCalledOnce();
  });

  it('does nothing when no hooks are registered', async () => {
    expect(await createShutdownRegistry().run()).toBe(true);
  });
});
