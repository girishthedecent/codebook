import { APICallError, RetryError } from 'ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../config/app.config.js';
import {
  breakerStates,
  dailyLimitResetsIn,
  isDailyLimit,
  isOpen,
  isQuotaError,
  noteQuotaError,
  resetCircuitBreaker,
} from './circuitBreaker.js';
import type { ModelRef } from './models.js';

const groq: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-120b' };
const otherGroq: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-20b' };
const { coolOffMs } = appConfig.circuitBreaker;

const apiError = (statusCode: number, message = 'failed', responseBody?: string) =>
  new APICallError({
    message,
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode,
    responseBody,
  });

beforeEach(() => {
  resetCircuitBreaker();
});

describe('other keys', () => {
  it('keep their own state, so the first key running out does not skip the second', () => {
    const gemini: ModelRef = { provider: 'google', model: 'gemini-3.6-flash' };
    const second: ModelRef = { ...gemini, key: 1 };
    noteQuotaError(gemini);
    expect(isOpen(gemini)).toBe(true);
    expect(isOpen(second)).toBe(false);
  });
});

describe('isQuotaError', () => {
  it('recognizes 429s and quota-exhausted answers', () => {
    expect(isQuotaError(apiError(429))).toBe(true);
    expect(isQuotaError(apiError(403, 'Resource has been exhausted (e.g. check quota).'))).toBe(
      true,
    );
    expect(isQuotaError(apiError(400, 'bad', '{"error":{"code":"rate_limit_exceeded"}}'))).toBe(
      true,
    );
  });

  it('looks inside a RetryError', () => {
    const wrapped = new RetryError({
      message: 'gave up',
      reason: 'maxRetriesExceeded',
      errors: [apiError(429)],
    });
    expect(isQuotaError(wrapped)).toBe(true);
  });

  it('ignores other failures', () => {
    expect(isQuotaError(apiError(500, 'internal'))).toBe(false);
    expect(isQuotaError(apiError(400, 'invalid tool call'))).toBe(false);
    expect(isQuotaError(new Error('timeout'))).toBe(false);
  });
});

describe('circuit breaker', () => {
  it('skips a model from its first quota error until the cool-off ends', () => {
    const start = 1_000_000;
    expect(isOpen(groq, start)).toBe(false);

    noteQuotaError(groq, start);
    expect(isOpen(groq, start)).toBe(true);
    expect(isOpen(otherGroq, start)).toBe(false);

    expect(isOpen(groq, start + coolOffMs - 1)).toBe(true);
    expect(isOpen(groq, start + coolOffMs)).toBe(false);
  });

  it('starts the cool-off again on the next error', () => {
    const start = 1_000_000;
    noteQuotaError(groq, start);
    noteQuotaError(groq, start + coolOffMs);
    expect(isOpen(groq, start + coolOffMs)).toBe(true);
    expect(isOpen(groq, start + 2 * coolOffMs)).toBe(false);
  });
});

describe('breakerStates', () => {
  const start = 1_000_000;

  it('is empty until a model has had a quota error', () => {
    expect(breakerStates(start)).toEqual([]);
  });

  it('reports an open model with when it closes, and closed again after that', () => {
    noteQuotaError(groq, start);

    expect(breakerStates(start + 1)).toEqual([
      { model: 'groq/openai/gpt-oss-120b', open: true, openUntil: new Date(start + coolOffMs) },
    ]);
    expect(breakerStates(start + coolOffMs)[0]).toMatchObject({ open: false, openUntil: null });
  });

  it('lists another key apart from its model', () => {
    const third: ModelRef = { provider: 'google', model: 'gemini-3.6-flash', key: 2 };
    noteQuotaError(third, start);

    expect(breakerStates(start).map((state) => state.model)).toEqual(['google/gemini-3.6-flash#3']);
  });
});

// The shape of Gemini's 429 body: the metric is the same for a minute's and a day's limit, so
// only the quotaId tells them apart.
const geminiBody = (quotaId: string) =>
  JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId,
              quotaValue: '20',
            },
          ],
        },
      ],
    },
  });
const geminiDaily = apiError(
  429,
  'Quota exceeded',
  geminiBody('GenerateRequestsPerDayPerProjectPerModel-FreeTier'),
);
const geminiMinute = apiError(
  429,
  'Quota exceeded',
  geminiBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'),
);
const groqDaily = apiError(
  429,
  'Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000, Used 199500, Requested 1200. Please try again in 7m12.5s.',
);

describe('daily limits', () => {
  const gemini: ModelRef = { provider: 'google', model: 'gemini-3.6-flash' };

  it('tells a day limit from a minute limit', () => {
    expect(isDailyLimit(geminiDaily)).toBe(true);
    expect(isDailyLimit(geminiMinute)).toBe(false);
    expect(isDailyLimit(groqDaily)).toBe(true);
    expect(isDailyLimit(apiError(429, 'on tokens per minute (TPM): Limit 8000'))).toBe(false);
    expect(
      isDailyLimit(
        new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [geminiDaily] }),
      ),
    ).toBe(true);
  });

  it('skips a Gemini key from its first daily error until midnight Pacific', () => {
    // 10:00 PDT on a summer day, so midnight is 14 hours away.
    const now = Date.parse('2026-07-15T17:00:00Z');
    noteQuotaError(gemini, now, geminiDaily);
    expect(isOpen(gemini, now)).toBe(true);
    expect(isOpen(gemini, now + 14 * 60 * 60 * 1000 - 1)).toBe(true);
    expect(isOpen(gemini, now + 14 * 60 * 60 * 1000 + 61_000)).toBe(false);
  });

  it('counts midnight in standard time too', () => {
    // 10:00 PST in winter is 18:00 UTC.
    const now = Date.parse('2026-12-15T18:00:00Z');
    expect(dailyLimitResetsIn(gemini, geminiDaily, now)).toBe(14 * 60 * 60 * 1000 + 60_000);
  });

  it('skips a minute limit only for the cool-off', () => {
    const now = Date.parse('2026-07-15T17:00:00Z');
    noteQuotaError(gemini, now, geminiMinute);
    expect(isOpen(gemini, now)).toBe(true);
    expect(isOpen(gemini, now + coolOffMs)).toBe(false);
  });

  it('skips a Groq model for as long as Groq says to wait', () => {
    const now = Date.parse('2026-07-15T17:00:00Z');
    expect(dailyLimitResetsIn(groq, groqDaily, now)).toBe(432_500);
    noteQuotaError(groq, now, groqDaily);
    expect(isOpen(groq, now + 432_000)).toBe(true);
    expect(isOpen(groq, now + 433_000)).toBe(false);
  });

  it('uses the cool-off when a day limit gives no time to wait', () => {
    const now = Date.parse('2026-07-15T17:00:00Z');
    noteQuotaError(groq, now, apiError(429, 'on requests per day (RPD): Limit 1000, Used 1000'));
    expect(isOpen(groq, now + coolOffMs - 1)).toBe(true);
    expect(isOpen(groq, now + coolOffMs)).toBe(false);
  });
});
