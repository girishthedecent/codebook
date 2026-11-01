import { APICallError, RetryError } from 'ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../config/app.config.js';
import {
  breakerStates,
  isOpen,
  isQuotaError,
  noteQuotaError,
  resetCircuitBreaker,
} from './circuitBreaker.js';
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

describe('other keys', () => {
  it('keep their own state, so the first key running out does not skip the second', () => {
    const gemini: ModelRef = { provider: 'google', model: 'gemini-3.6-flash' };
    const second: ModelRef = { ...gemini, key: 1 };
    for (let i = 0; i < quotaErrors; i++) noteQuotaError(gemini);
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

describe('breakerStates', () => {
  const start = 1_000_000;

  it('is empty until a model has had a quota error', () => {
    expect(breakerStates(start)).toEqual([]);
  });

  it('reports a model with errors short of opening, and counts only the window', () => {
    noteQuotaError(groq, start);
    noteQuotaError(groq, start + windowMs - 1);

    expect(breakerStates(start + windowMs - 1)).toEqual([
      { model: 'groq/openai/gpt-oss-120b', open: false, openUntil: null, recentQuotaErrors: 2 },
    ]);
    expect(breakerStates(start + windowMs)[0]).toMatchObject({ recentQuotaErrors: 1 });
  });

  it('reports an open model with when it closes, and closed again after that', () => {
    for (let i = 0; i < quotaErrors; i++) noteQuotaError(groq, start);
    noteQuotaError(otherGroq, start);

    const states = breakerStates(start + 1);
    expect(states.find((state) => state.model === 'groq/openai/gpt-oss-120b')).toEqual({
      model: 'groq/openai/gpt-oss-120b',
      open: true,
      openUntil: new Date(start + coolOffMs),
      recentQuotaErrors: 0,
    });
    expect(states.find((state) => state.model === 'groq/openai/gpt-oss-20b')?.open).toBe(false);

    expect(breakerStates(start + coolOffMs)[0]).toMatchObject({ open: false, openUntil: null });
  });

  it('lists another key apart from its model', () => {
    const third: ModelRef = { provider: 'google', model: 'gemini-3.6-flash', key: 2 };
    noteQuotaError(third, start);

    expect(breakerStates(start).map((state) => state.model)).toEqual(['google/gemini-3.6-flash#3']);
  });
});
