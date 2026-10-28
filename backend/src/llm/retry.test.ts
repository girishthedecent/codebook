import { APICallError } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import {
  describeError,
  LlmTimeoutError,
  parseRetryAfterMs,
  quotaHits,
  retryDelayMs,
  withRetry,
} from './retry.js';

const policy = {
  maxRetries: 2,
  maxRetriesWithFallback: 1,
  baseDelayMs: 1,
  maxDelayMs: 4,
  maxRetryAfterMs: 5_000,
};

function apiError(
  statusCode: number,
  responseHeaders?: Record<string, string>,
  message = `HTTP ${statusCode}`,
) {
  return new APICallError({
    message,
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

// Shaped like the providers' real answers; the ids are made up.
const GEMINI_QUOTA =
  'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.\n' +
  '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.6-flash\n' +
  'Please retry in 41.2s.';
const GROQ_QUOTA =
  'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_test` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 6127, Requested 2412. Please try again in 4.1s.';

describe('quotaHits', () => {
  it("reads the limit out of Gemini's and Groq's messages", () => {
    expect(quotaHits(apiError(429, undefined, GEMINI_QUOTA))).toEqual([
      { metric: 'generate_content_free_tier_requests', limit: 15, model: 'gemini-3.6-flash' },
    ]);
    expect(quotaHits(apiError(429, undefined, GROQ_QUOTA))).toEqual([
      { metric: 'TPM', limit: 8000, used: 6127, requested: 2412 },
    ]);
  });

  it('finds nothing in other errors', () => {
    expect(quotaHits(apiError(503))).toEqual([]);
    expect(quotaHits(new Error('Quota exceeded for metric: x, limit: 1'))).toEqual([]);
  });

  it('puts the limit, not the links, in the error summary', () => {
    expect(describeError(apiError(429, undefined, GEMINI_QUOTA))).toBe(
      '429: Quota exceeded: generate_content_free_tier_requests limit 15',
    );
    expect(describeError(apiError(429, undefined, GROQ_QUOTA))).toBe(
      '429: Quota exceeded: TPM limit 8000, used 6127, requested 2412',
    );
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

  it('moves on to the fallback at once when the quota is used up', async () => {
    const call = vi.fn().mockRejectedValue(apiError(429));
    await expect(
      withRetry(call, { timeoutMs: 1_000, policy, hasFallback: true }),
    ).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('retries other errors fewer times when a fallback is waiting', async () => {
    const call = vi.fn().mockRejectedValue(apiError(503));
    await expect(
      withRetry(call, { timeoutMs: 1_000, policy, hasFallback: true }),
    ).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(2);
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
