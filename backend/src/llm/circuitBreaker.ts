import { APICallError, RetryError } from 'ai';
import { appConfig } from '../config/app.config.js';
import logger from '../config/logger.config.js';
import { modelLabel, type ModelRef } from './models.js';

// Free tiers run out per model (Groq counts each model on its own). A model that keeps
// answering "quota exhausted" is skipped for a while, so calls go straight to the fallback
// instead of paying for retries that will fail.

type ModelState = { errors: number[]; openUntil: number };

const states = new Map<string, ModelState>();

// The backup key is another project with its own quota, so it has its own state.
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

export function noteQuotaError(ref: ModelRef, now = Date.now()) {
  const { quotaErrors, windowMs, coolOffMs } = appConfig.circuitBreaker;
  const state = states.get(keyOf(ref)) ?? { errors: [], openUntil: 0 };
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

/** Forgets every model's state. For tests. */
export function resetCircuitBreaker() {
  states.clear();
}
