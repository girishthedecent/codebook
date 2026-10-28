import { createHash } from 'node:crypto';
import { embedMany } from 'ai';
import { appConfig } from '../config/app.config.js';
import logger from '../config/logger.config.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { UpstreamError } from '../utils/errors/app.error.js';
import { createWindowLimiter } from '../utils/pacer.js';
import type { CallContext } from './client.js';
import { findCachedEmbeddings, saveCachedEmbeddings } from './embeddingCache.repository.js';
import { isOpen, isQuotaError, noteQuotaError } from './circuitBreaker.js';
import {
  embeddingRoute,
  hasBackupKey,
  withBackupKey,
  type EmbedKind,
  type ModelRef,
} from './models.js';
import { estimateCost } from './pricing.js';
import { embeddingModel } from './providers.js';
import { describeError, withRetry } from './retry.js';
import { recordUsage } from './usage.repository.js';

export type { EmbedKind };

type EmbedOptions = {
  kind: EmbedKind;
  // Documents only: the source or section title, which the model uses as context.
  title?: string;
  abortSignal?: AbortSignal;
  ctx?: CallContext;
  // Search embeds a HyDE passage as a document, but a user is waiting on it: count it
  // against the quota without waiting for room.
  waitForQuota?: boolean;
};

// The free tier counts texts, not requests: 100 a minute for everyone. Ingestion
// waits to stay under documentsPerMinute; queries never wait (a user is waiting) but are
// counted, so a book being embedded can't push search over the limit.
const quota = createWindowLimiter(appConfig.llm.embeddings.documentsPerMinute, 60_000);

/** What the embedding model is sent for a text: the route's own format for its kind. */
export function embeddingInput(text: string, kind: EmbedKind, title?: string) {
  return embeddingRoute.input(text, kind, title);
}

export function embeddingCacheKey(kind: EmbedKind, input: string) {
  const { model, dimensions } = embeddingRoute;
  return createHash('sha256').update(`${model.model}|${dimensions}|${kind}|${input}`).digest('hex');
}

/**
 * Embeds texts as unit-length vectors, in input order. Cached vectors are reused; the rest
 * go to the provider in batches, and each batch is cached as soon as it succeeds, so a
 * retry after a failure only pays for what's left.
 */
export async function embedTexts(texts: string[], options: EmbedOptions): Promise<number[][]> {
  const inputs = texts.map((text) => embeddingInput(text, options.kind, options.title));
  const keys = inputs.map((input) => embeddingCacheKey(options.kind, input));
  const vectors = await findCachedEmbeddings([...new Set(keys)]);

  const missing = new Map<string, string>();
  keys.forEach((key, i) => {
    if (!vectors.has(key)) missing.set(key, inputs[i]!);
  });

  if (missing.size > 0) {
    const fresh = await embedMissing([...missing], options);
    for (const [key, vector] of fresh) vectors.set(key, vector);
  }

  return keys.map((key) => vectors.get(key)!);
}

async function embedMissing(entries: [key: string, input: string][], options: EmbedOptions) {
  const { model, dimensions, timeoutMs } = embeddingRoute;
  const { batchSize, concurrency } = appConfig.llm.embeddings;
  const started = performance.now();
  const results = new Map<string, number[]>();
  let tokensIn = 0;

  const batches: [string, string][][] = [];
  for (let i = 0; i < entries.length; i += batchSize) batches.push(entries.slice(i, i + batchSize));

  // The same model on the backup key (another project's quota) when the first key fails.
  // The vectors are identical, so the two can be mixed freely.
  const refs = withBackupKey([model], hasBackupKey());
  let usedBackup = false;
  // The key of the attempt whose error is thrown; batches in flight can't overwrite it.
  let failedOn: ModelRef | undefined;
  const embedWithFallback = async (values: string[]) => {
    let lastError: unknown;
    let lastRef = refs[0]!;
    for (const [index, ref] of refs.entries()) {
      if (index < refs.length - 1 && isOpen(ref)) continue;
      lastRef = ref;
      try {
        const result = await withRetry(
          (signal) =>
            embedMany({
              model: embeddingModel(ref),
              values,
              dimensions,
              maxRetries: 0,
              abortSignal: signal,
            }),
          { timeoutMs, signal: options.abortSignal, hasFallback: index < refs.length - 1 },
        );
        if (ref.key) usedBackup = true;
        return result;
      } catch (error) {
        lastError = error;
        // With one key there's nothing to skip to, so its breaker would only log.
        if (refs.length > 1 && isQuotaError(error)) noteQuotaError(ref);
        if (options.abortSignal?.aborted) break;
      }
    }
    failedOn ??= lastRef;
    throw lastError;
  };

  const embedBatch = async (batch: [string, string][]) => {
    const values = batch.map(([, input]) => input);
    if (options.kind === 'document' && options.waitForQuota !== false) {
      await quota.take(values.length);
    } else quota.record(values.length);
    const { embeddings, usage } = await embedWithFallback(values);

    // Providers that don't report token counts get the route's estimate.
    tokensIn +=
      usage.tokens || values.reduce((sum, value) => sum + embeddingRoute.estimateTokens(value), 0);
    const normalized = embeddings.map((embedding) => normalize(embedding, dimensions));
    batch.forEach(([key], i) => results.set(key, normalized[i]!));

    // The vectors are already paid for; a cache that can't be written shouldn't throw them away.
    try {
      await saveCachedEmbeddings(batch.map(([key], i) => ({ key, embedding: normalized[i]! })));
    } catch (error) {
      logger.error('Failed to cache embeddings', { error, texts: batch.length });
    }
  };

  let error: unknown;
  try {
    await runWithConcurrency(batches, concurrency, embedBatch);
  } catch (err) {
    error = err;
  }

  const tokens = { tokensIn, tokensOut: 0, tokensCached: 0 };
  await recordUsage({
    type: 'EMBEDDING',
    task: 'embed',
    userId: options.ctx?.userId,
    workspaceId: options.ctx?.workspaceId,
    provider: model.provider,
    model: model.model,
    // One row covers every batch: a success says whether any went to the backup key, a
    // failure names the key its last attempt used.
    key: (error === undefined ? usedBackup : failedOn?.key === 'backup') ? 'backup' : undefined,
    ...tokens,
    costUsd: estimateCost(model.model, tokens),
    latencyMs: Math.round(performance.now() - started),
    ok: error === undefined,
    error: error === undefined ? undefined : describeError(error),
  });

  if (error !== undefined) {
    if (options.abortSignal?.aborted) throw options.abortSignal.reason;
    logger.warn('Embedding failed', { error: describeError(error), texts: entries.length });
    throw new UpstreamError('Embeddings');
  }
  return results;
}

/** Scales to unit length, so cosine similarity and inner product agree. */
export function normalize(vector: number[], dimensions: number) {
  if (vector.length !== dimensions) {
    throw new Error(`Expected a ${dimensions}-dimension embedding, got ${vector.length}`);
  }
  const norm = Math.hypot(...vector);
  if (norm === 0) throw new Error('Got an all-zero embedding');
  return vector.map((value) => value / norm);
}
