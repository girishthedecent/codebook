import { APICallError, RetryError } from 'ai';
import { appConfig } from '../config/app.config.js';
import logger from '../config/logger.config.js';
import { modelLabel, type ModelRef } from './models.js';

// Free tiers run out per model (Groq counts each model on its own). A model that keeps
// answering "quota exhausted" is skipped for a while, so calls go straight to the fallback
// instead of paying for retries that will fail.

type ModelState = { errors: number[]; openUntil: number };

const states = new Map<string, ModelState>();

// Each key of a provider is another project with its own quota, so it has its own state.
const keyOf = modelLabel;

/** True for a rate-limit or quota-exhausted answer from the provider. */
export function isQuotaError(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isQuotaError(error.lastError);
  if (!APICallError.isInstance(error)) return false;
  if (error.statusCode === 429) return true;
  return /quota|resource.?exhausted|rate.?limit/i.test(
    `${error.message} ${error.responseBody ?? ''}`,
  );
}

// A day's limit doesn't come back in five minutes, so a key that used one up is skipped until
// it starts over instead of failing a few calls every cool-off. Gemini names the limit in the
// 429's QuotaFailure details (a quotaId such as "GenerateRequestsPerDayPerProjectPerModel");
// Groq names it in the message ("tokens per day (TPD)") and says when to try again.
const DAY_MS = 24 * 60 * 60 * 1000;

/** True when the quota that ran out is a daily one. */
export function isDailyLimit(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isDailyLimit(error.lastError);
  if (!APICallError.isInstance(error)) return false;
  const text = `${error.message} ${error.responseBody ?? ''}`;
  return /"quotaId"\s*:\s*"[^"]*PerDay/i.test(text) || /\((?:RPD|TPD)\)/.test(text);
}

/** Milliseconds until a daily limit starts over, or undefined when the error doesn't say. */
export function dailyLimitResetsIn(ref: ModelRef, error: unknown, now: number) {
  if (RetryError.isInstance(error)) return dailyLimitResetsIn(ref, error.lastError, now);
  if (!APICallError.isInstance(error)) return undefined;
  if (ref.provider === 'google') return untilPacificMidnight(now);
  // Groq: "Please try again in 1h2m3.5s", any part optional.
  const wait = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/.exec(error.message);
  if (!wait || !wait[0].match(/\d/)) return undefined;
  const [, h = '0', m = '0', sec = '0'] = wait;
  const ms = ((Number(h) * 60 + Number(m)) * 60 + Number(sec)) * 1000;
  return Math.min(Math.ceil(ms), DAY_MS);
}

// Gemini's daily quotas start over at midnight Pacific time. A minute's slack keeps the first
// call after it from landing on the old day.
function untilPacificMidnight(now: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000;
  return DAY_MS - elapsed + 60_000;
}

export function noteQuotaError(ref: ModelRef, now = Date.now(), error?: unknown) {
  const { quotaErrors, windowMs, coolOffMs } = appConfig.circuitBreaker;
  const state = states.get(keyOf(ref)) ?? { errors: [], openUntil: 0 };
  const resetsIn =
    error !== undefined && isDailyLimit(error) ? dailyLimitResetsIn(ref, error, now) : undefined;
  if (resetsIn !== undefined) {
    state.openUntil = Math.max(state.openUntil, now + resetsIn);
    state.errors = [];
    logger.warn('Model daily quota used up; skipping it until it starts over', {
      model: modelLabel(ref),
      until: new Date(state.openUntil).toISOString(),
    });
    states.set(keyOf(ref), state);
    return;
  }
  state.errors = [...state.errors.filter((at) => now - at < windowMs), now];
  if (state.errors.length >= quotaErrors && state.openUntil <= now) {
    state.openUntil = now + coolOffMs;
    state.errors = [];
    logger.warn('Model quota exhausted; skipping it for a while', {
      model: modelLabel(ref),
      untilMs: coolOffMs,
    });
  }
  states.set(keyOf(ref), state);
}

/** True while the model is being skipped after repeated quota errors. */
export function isOpen(ref: ModelRef, now = Date.now()) {
  const state = states.get(keyOf(ref));
  return state !== undefined && state.openUntil > now;
}

export type BreakerState = {
  // modelLabel(): "provider/model", plus "#2", "#3"... for the provider's other keys.
  model: string;
  open: boolean;
  openUntil: Date | null;
  // Quota errors inside the current window, not yet enough to open it.
  recentQuotaErrors: number;
};

/** What the breaker knows about every model it has seen a quota error from. For monitoring. */
export function breakerStates(now = Date.now()): BreakerState[] {
  const { windowMs } = appConfig.circuitBreaker;
  return [...states].map(([model, state]) => {
    const open = state.openUntil > now;
    return {
      model,
      open,
      openUntil: open ? new Date(state.openUntil) : null,
      recentQuotaErrors: state.errors.filter((at) => now - at < windowMs).length,
    };
  });
}

/** Forgets every model's state. For tests. */
export function resetCircuitBreaker() {
  states.clear();
}
