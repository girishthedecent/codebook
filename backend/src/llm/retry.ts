import { setTimeout as sleep } from 'node:timers/promises';
import { APICallError } from 'ai';
import { appConfig } from '../config/app.config.js';
import logger from '../config/logger.config.js';

export class LlmTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Model call timed out after ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
  }
}

/** A short, log-safe summary of a failed call: status and message, no request bodies. */
export function describeError(error: unknown) {
  let text: string;
  if (APICallError.isInstance(error)) text = `${error.statusCode ?? 'network'}: ${error.message}`;
  else if (error instanceof LlmTimeoutError) text = error.message;
  else if (error instanceof Error) text = `${error.name}: ${error.message}`;
  else text = String(error);
  return text.slice(0, 300);
}

export type RetryPolicy = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetryAfterMs: number;
};

/** Reads `retry-after-ms` or `retry-after` (seconds or an HTTP date). Header names are lowercase. */
export function parseRetryAfterMs(headers: Record<string, string> | undefined) {
  const retryAfterMs = headers?.['retry-after-ms'];
  if (retryAfterMs) {
    const ms = Number(retryAfterMs);
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }

  const value = headers?.['retry-after'];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * How long to wait before trying the same model again, or null when it isn't worth it:
 * the error isn't a rate limit / server / network error, or the provider asks us to wait
 * longer than the policy allows (the fallback model answers sooner).
 */
export function retryDelayMs(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
) {
  if (!APICallError.isInstance(error) || !error.isRetryable) return null;

  const retryAfter = parseRetryAfterMs(error.responseHeaders);
  if (retryAfter !== undefined) return retryAfter <= policy.maxRetryAfterMs ? retryAfter : null;

  // Full jitter: callers that failed together don't all come back at the same moment.
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

type RetryOptions = {
  timeoutMs: number;
  // The caller's signal, e.g. the client disconnecting. Never retried.
  signal?: AbortSignal;
  policy?: RetryPolicy;
};

/**
 * Runs `call` with a fresh timeout per attempt and retries the errors `retryDelayMs`
 * allows. A timeout isn't retried: the same model is likely to be slow again.
 */
export async function withRetry<T>(
  call: (signal: AbortSignal) => Promise<T>,
  { timeoutMs, signal, policy = appConfig.llm.retry }: RetryOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await withTimeout(call, timeoutMs, signal);
    } catch (error) {
      const delay = attempt < policy.maxRetries ? retryDelayMs(error, attempt, policy) : null;
      if (delay === null || signal?.aborted) throw error;

      logger.warn('Model call failed, retrying', {
        attempt: attempt + 1,
        delayMs: delay,
        status: APICallError.isInstance(error) ? error.statusCode : undefined,
      });
      await sleep(delay, undefined, { signal });
    }
  }
}

async function withTimeout<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new LlmTimeoutError(timeoutMs)), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

  try {
    return await call(combined);
  } catch (error) {
    // Whatever the SDK wrapped the abort in, report it as our timeout.
    if (timeout.signal.aborted && !signal?.aborted) throw timeout.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
