import { resolve } from 'node:path';
import type { PreTrainedModel, PreTrainedTokenizer, Tensor } from '@huggingface/transformers';
import { appConfig } from '../config/app.config.js';
import { serverConfig } from '../config/index.js';
import logger from '../config/logger.config.js';
import type { RerankOptions } from '../modules/retrieval/retrieval.types.js';
import { describeError } from './retry.js';
import { recordUsage } from './usage.repository.js';

// A local cross-encoder: it reads the question and a passage together and scores how well
// the passage answers it. Runs on the CPU in this process, so search keeps working without
// an API key or quota.

type Loaded = { tokenizer: PreTrainedTokenizer; model: PreTrainedModel };

// One load per model id. A failed load (often the first download, interrupted) is tried
// again after a cooldown, not on every search, which would only slow searches down.
const LOAD_RETRY_MS = 5 * 60 * 1000;
const loads = new Map<string, Promise<Loaded | null>>();
const failedAt = new Map<string, number>();

function load(modelId: string) {
  let loading = loads.get(modelId);
  const failed = failedAt.get(modelId);
  if (!loading || (failed !== undefined && Date.now() - failed > LOAD_RETRY_MS)) {
    failedAt.delete(modelId);
    loading = loadModel(modelId).then((loaded) => {
      if (!loaded) failedAt.set(modelId, Date.now());
      return loaded;
    });
    loads.set(modelId, loading);
  }
  return loading;
}

async function loadModel(modelId: string): Promise<Loaded | null> {
  const started = performance.now();
  try {
    // Imported here so the native runtime only loads when a search first needs it.
    const { AutoModelForSequenceClassification, AutoTokenizer } =
      await import('@huggingface/transformers');
    const options = { cache_dir: resolve(serverConfig.RERANKER_CACHE_DIR) };
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(modelId, options),
      AutoModelForSequenceClassification.from_pretrained(modelId, { ...options, dtype: 'q8' }),
    ]);
    logger.info('Reranker loaded', { model: modelId, ms: Math.round(performance.now() - started) });
    return { tokenizer, model };
  } catch (error) {
    logger.warn('Reranker failed to load; searches keep the fused order', {
      model: modelId,
      error: describeError(error),
    });
    return null;
  }
}

/** Loads the default model in the background, so the first search doesn't wait for it. */
export async function warmUpReranker() {
  await load(serverConfig.RERANKER_MODEL);
}

/**
 * Scores each doc against the query, in input order (0..1, higher is more relevant).
 * Null when the model is unavailable, so the caller keeps its own order.
 */
export async function rerank(
  query: string,
  docs: string[],
  options: RerankOptions = {},
): Promise<number[] | null> {
  const modelId = options.model ?? serverConfig.RERANKER_MODEL;
  if (docs.length === 0) return [];
  const loaded = await load(modelId);
  if (!loaded) return null;

  const started = performance.now();
  const { batchSize } = appConfig.retrieval.reranker;
  const scores: number[] = [];
  let tokensIn = 0;
  try {
    const fitted = fitDocs(loaded.tokenizer, query, docs);
    for (let i = 0; i < fitted.length; i += batchSize) {
      options.signal?.throwIfAborted();
      const batch = fitted.slice(i, i + batchSize);
      const inputs = loaded.tokenizer(
        batch.map(() => query),
        {
          text_pair: batch,
          padding: true,
          truncation: true,
          max_length: appConfig.retrieval.reranker.maxTokens,
        },
      );
      const { logits } = (await loaded.model(inputs)) as { logits: Tensor };
      // One relevance logit per pair.
      const width = logits.dims[1] ?? 1;
      for (let row = 0; row < batch.length; row++) {
        scores.push(sigmoid(Number(logits.data[row * width])));
      }
      tokensIn += countTokens(inputs.attention_mask as Tensor);
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    logger.warn('Rerank failed; keeping the fused order', {
      model: modelId,
      error: describeError(error),
    });
    await record(modelId, options, { tokensIn, started, error: describeError(error) });
    return null;
  }

  await record(modelId, options, { tokensIn, started });
  return scores;
}

/**
 * Cuts each doc so query + doc fit the model's input, never the query. The tokenizer's own
 * truncation drops tokens from the end of the pair, closing separator included, so docs
 * are shortened here first and its truncation only catches a token or two of drift.
 */
function fitDocs(tokenizer: PreTrainedTokenizer, query: string, docs: string[]) {
  const { maxTokens } = appConfig.retrieval.reranker;
  const special = tokenizer.encode('a', { text_pair: 'b' }).length - 2;
  const room = maxTokens - special - tokenizer.encode(query, { add_special_tokens: false }).length;
  // A query this long can't leave the doc any room; the tokenizer's cut has to do.
  if (room < 32) return docs;

  return docs.map((doc) => {
    const ids = tokenizer.encode(doc, { add_special_tokens: false });
    if (ids.length <= room) return doc;
    return tokenizer.decode(ids.slice(0, room), { skip_special_tokens: true });
  });
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

function countTokens(mask: Tensor) {
  let total = 0;
  for (const value of mask.data) total += Number(value);
  return total;
}

async function record(
  modelId: string,
  options: RerankOptions,
  run: { tokensIn: number; started: number; error?: string },
) {
  await recordUsage({
    userId: options.ctx?.userId,
    workspaceId: options.ctx?.workspaceId,
    type: 'RERANK',
    task: 'rerank',
    provider: 'local',
    model: modelId,
    tokensIn: run.tokensIn,
    tokensOut: 0,
    costUsd: 0,
    latencyMs: Math.round(performance.now() - run.started),
    ok: !run.error,
    error: run.error,
  });
}
