import { setTimeout as sleep } from 'node:timers/promises';
import { APICallError } from 'ai';
import { appConfig } from '../config/app.config.js';
import logger from '../config/logger.config.js';
import { isQuotaError } from './circuitBreaker.js';

export class LlmTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Model call timed out after ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
  }
}

export type QuotaHit = {
  metric: string;
  limit: number;
  used?: number;
  requested?: number;
  model?: string;
};

/**
 * The limits a rate-limit answer says ran out, so the logs and usage rows name them. Both
 * providers only put them in the message text; anything else gives an empty list.
 */
export function quotaHits(error: unknown): QuotaHit[] {
  if (!APICallError.isInstance(error)) return [];
  const hits: QuotaHit[] = [];
  // Gemini, one line per limit: "Quota exceeded for metric: <metric>, limit: 15, model: <id>"
  for (const match of error.message.matchAll(
    /Quota exceeded for metric: ([^,\n]+), limit: (\d+)(?:, model: ([^\s,]+))?/g,
  )) {
    hits.push({
      metric: match[1]!.replace(/^generativelanguage\.googleapis\.com\//, ''),
      limit: Number(match[2]),
      model: match[3],
    });
  }
  // Groq: "... on tokens per minute (TPM): Limit 8000, Used 6127, Requested 2412."
  const groq = /\((\w+)\): Limit (\d+), Used (\d+), Requested (\d+)/.exec(error.message);
  if (groq) {
    hits.push({
      metric: groq[1]!,
      limit: Number(groq[2]),
      used: Number(groq[3]),
      requested: Number(groq[4]),
    });
  }
  return hits;
}

const describeHit = (hit: QuotaHit) =>
  `${hit.metric} limit ${hit.limit}${hit.used === undefined ? '' : `, used ${hit.used}`}${
    hit.requested === undefined ? '' : `, requested ${hit.requested}`
  }`;

/** A short, log-safe summary of a failed call: status and message, no request bodies. */
export function describeError(error: unknown) {
  let text: string;
  const hits = quotaHits(error);
  // The quota messages open with a paragraph of links; the limit that ran out says more.
  if (APICallError.isInstance(error) && hits.length > 0) {
    text = `${error.statusCode ?? 'network'}: Quota exceeded: ${hits.map(describeHit).join('; ')}`;
  } else if (APICallError.isInstance(error)) {
    text = `${error.statusCode ?? 'network'}: ${error.message}`;
  } else if (error instanceof LlmTimeoutError) text = error.message;
  else if (error instanceof Error) text = `${error.name}: ${error.message}`;
  else text = String(error);
  return text.slice(0, 300);
}

export type RetryPolicy = {
  maxRetries: number;
  // Used instead when another model or key is next in line.
  maxRetriesWithFallback: number;
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
  // Another model or key is next in line. A used-up quota moves on to it at once, and other
  // errors get fewer retries: the next one is likely to answer sooner than this one recovers.
  hasFallback?: boolean;
};

/**
 * Runs `call` with a fresh timeout per attempt and retries the errors `retryDelayMs`
 * allows. A timeout isn't retried: the same model is likely to be slow again.
 */
export async function withRetry<T>(
  call: (signal: AbortSignal) => Promise<T>,
  { timeoutMs, signal, policy = appConfig.llm.retry, hasFallback = false }: RetryOptions,
): Promise<T> {
  const retries = hasFallback ? policy.maxRetriesWithFallback : policy.maxRetries;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await withTimeout(call, timeoutMs, signal);
    } catch (error) {
      const moveOn = attempt >= retries || (hasFallback && isQuotaError(error));
      const delay = moveOn ? null : retryDelayMs(error, attempt, policy);
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
