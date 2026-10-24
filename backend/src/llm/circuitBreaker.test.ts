import { APICallError, RetryError } from 'ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../config/app.config.js';
import { isOpen, isQuotaError, noteQuotaError, resetCircuitBreaker } from './circuitBreaker.js';
import type { ModelRef } from './models.js';

const groq: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-120b' };
const otherGroq: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-20b' };
const { quotaErrors, windowMs, coolOffMs } = appConfig.circuitBreaker;

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
  it('opens a model after enough quota errors in the window, and closes after the cool-off', () => {
    const start = 1_000_000;
    for (let i = 0; i < quotaErrors - 1; i++) noteQuotaError(groq, start + i);
    expect(isOpen(groq, start + quotaErrors)).toBe(false);

    noteQuotaError(groq, start + quotaErrors);
    expect(isOpen(groq, start + quotaErrors)).toBe(true);
    expect(isOpen(otherGroq, start + quotaErrors)).toBe(false);

    expect(isOpen(groq, start + quotaErrors + coolOffMs - 1)).toBe(true);
    expect(isOpen(groq, start + quotaErrors + coolOffMs)).toBe(false);
  });

  it('only counts errors inside the window', () => {
    const start = 1_000_000;
    for (let i = 0; i < quotaErrors - 1; i++) noteQuotaError(groq, start);
    noteQuotaError(groq, start + windowMs + 1);

    expect(isOpen(groq, start + windowMs + 1)).toBe(false);
  });

  it('needs a fresh run of errors to open again after closing', () => {
    const start = 1_000_000;
    for (let i = 0; i < quotaErrors; i++) noteQuotaError(groq, start);
    const reopenAt = start + coolOffMs;
    expect(isOpen(groq, reopenAt)).toBe(false);

    noteQuotaError(groq, reopenAt);
    expect(isOpen(groq, reopenAt)).toBe(false);
  });
});
