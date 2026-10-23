import { APICallError } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { LlmTimeoutError, parseRetryAfterMs, retryDelayMs, withRetry } from './retry.js';

const policy = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 4, maxRetryAfterMs: 5_000 };

function apiError(statusCode: number, responseHeaders?: Record<string, string>) {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://provider.test',
    requestBodyValues: {},
    statusCode,
    responseHeaders,
  });
}

describe('parseRetryAfterMs', () => {
  it('reads milliseconds, seconds and HTTP dates', () => {
    expect(parseRetryAfterMs({ 'retry-after-ms': '1500' })).toBe(1500);
    expect(parseRetryAfterMs({ 'retry-after': '2' })).toBe(2000);
    const date = new Date(Date.now() + 3_000).toUTCString();
    expect(parseRetryAfterMs({ 'retry-after': date })).toBeGreaterThan(1_000);
  });

  it('ignores missing or unreadable headers', () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs({})).toBeUndefined();
    expect(parseRetryAfterMs({ 'retry-after': 'soon' })).toBeUndefined();
  });
});

describe('retryDelayMs', () => {
  it('retries rate limits, server errors and network failures', () => {
    for (const status of [408, 429, 500, 503]) {
      expect(retryDelayMs(apiError(status), 0, policy)).not.toBeNull();
    }
  });

  it('does not retry client errors or non-HTTP errors', () => {
    expect(retryDelayMs(apiError(400), 0, policy)).toBeNull();
    expect(retryDelayMs(apiError(401), 0, policy)).toBeNull();
    expect(retryDelayMs(new Error('bad json'), 0, policy)).toBeNull();
    expect(retryDelayMs(new LlmTimeoutError(10), 0, policy)).toBeNull();
  });

  it('waits as long as retry-after asks, up to the cap', () => {
    expect(retryDelayMs(apiError(429, { 'retry-after': '3' }), 0, policy)).toBe(3_000);
    expect(retryDelayMs(apiError(429, { 'retry-after': '30' }), 0, policy)).toBeNull();
  });

  it('backs off exponentially with full jitter, capped', () => {
    const slow = { ...policy, baseDelayMs: 100, maxDelayMs: 300 };
    expect(retryDelayMs(apiError(503), 0, slow, () => 0.999)).toBe(99);
    expect(retryDelayMs(apiError(503), 1, slow, () => 0.999)).toBe(199);
    expect(retryDelayMs(apiError(503), 5, slow, () => 0.999)).toBe(299);
    expect(retryDelayMs(apiError(503), 1, slow, () => 0)).toBe(0);
  });
});

describe('withRetry', () => {
  it('retries until the call succeeds', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(apiError(429))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValue('ok');

    await expect(withRetry(call, { timeoutMs: 1_000, policy })).resolves.toBe('ok');
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const call = vi.fn().mockRejectedValue(apiError(429));
    await expect(withRetry(call, { timeoutMs: 1_000, policy })).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('turns a slow call into a timeout and does not retry it', async () => {
    const call = vi.fn(
      (signal: AbortSignal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    await expect(withRetry(call, { timeoutMs: 20, policy })).rejects.toBeInstanceOf(
      LlmTimeoutError,
    );
    expect(call).toHaveBeenCalledOnce();
  });

  it('stops when the caller aborts, even on a retryable error', async () => {
    const controller = new AbortController();
    const call = vi.fn(() => {
      controller.abort();
      return Promise.reject(apiError(429));
    });
    await expect(
      withRetry(call, { timeoutMs: 1_000, signal: controller.signal, policy }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(call).toHaveBeenCalledOnce();
  });
});
