import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { LlmTimeoutError } from '../../llm/retry.js';
import { UpstreamError } from '../../utils/errors/app.error.js';
import { errorCodeOf, failureCode, STUDY_ERROR_MESSAGES } from './study.errors.js';

describe('failureCode', () => {
  const quota = new APICallError({
    message: 'Quota exceeded',
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode: 429,
  });

  it('calls a model that timed out TIMEOUT', () => {
    expect(failureCode(new UpstreamError('LLM', {}, { cause: new LlmTimeoutError(60_000) }))).toBe(
      'TIMEOUT',
    );
  });

  it('calls any other model failure MODEL_UNAVAILABLE', () => {
    expect(failureCode(new UpstreamError('LLM', {}, { cause: quota }))).toBe('MODEL_UNAVAILABLE');
    expect(failureCode(new UpstreamError('LLM'))).toBe('MODEL_UNAVAILABLE');
  });

  it('calls anything that is not a model failure GENERATION_FAILED', () => {
    expect(failureCode(new Error('database went away'))).toBe('GENERATION_FAILED');
    expect(failureCode('boom')).toBe('GENERATION_FAILED');
  });
});

describe('errorCodeOf', () => {
  const failed = { status: 'FAILED', error: 'Something', errorCode: null };

  it('is the stored code of a failed set', () => {
    expect(errorCodeOf({ ...failed, errorCode: 'TIMEOUT' })).toBe('TIMEOUT');
  });

  it('reads a set that failed before codes existed from its message', () => {
    expect(errorCodeOf({ ...failed, error: STUDY_ERROR_MESSAGES.CANCELLED })).toBe('CANCELLED');
    expect(errorCodeOf(failed)).toBe('GENERATION_FAILED');
    expect(errorCodeOf({ ...failed, errorCode: 'something new' })).toBe('GENERATION_FAILED');
  });

  it('is null for a set that has not failed', () => {
    for (const status of ['PENDING', 'RUNNING', 'DONE']) {
      expect(errorCodeOf({ status, error: null, errorCode: 'TIMEOUT' })).toBeNull();
    }
  });
});
