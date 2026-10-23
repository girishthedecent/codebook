import { createHash } from 'node:crypto';
import { APICallError } from 'ai';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import type { ModelRef } from '../../src/llm/models.js';

// Stand-in for src/llm/providers.ts. Use in a test file with:
//   vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
// then pick per-model behaviour with useModels().

const models = new Map<string, MockLanguageModelV4>();

export function useModels(byId: Record<string, MockLanguageModelV4>) {
  models.clear();
  for (const [id, model] of Object.entries(byId)) models.set(id, model);
}

export function languageModel(ref: ModelRef) {
  const model = models.get(ref.model);
  if (!model) throw new Error(`No mock for ${ref.model}; add it with useModels()`);
  return model;
}

export function embeddingModel() {
  return fakeEmbeddingModel;
}

const usage = (input: number, output: number, cached = 0) => ({
  inputTokens: { total: input, noCache: input - cached, cacheRead: cached, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

type Tokens = { input: number; output: number; cached?: number };

/**
 * Plays `steps` in order, one per call, repeating the last: a string is answered as text,
 * an Error is thrown.
 */
export function scriptedModel(
  steps: (string | Error)[],
  tokens: Tokens = { input: 100, output: 20 },
) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const step = steps[Math.min(call++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return {
        content: [{ type: 'text', text: step }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: usage(tokens.input, tokens.output, tokens.cached),
        warnings: [],
      };
    },
  });
}

/** Always answers `text`. */
export function textModel(text: string, tokens?: Tokens) {
  return scriptedModel([text], tokens);
}

/** Fails every call with `error`. */
export function failingModel(error: Error) {
  return scriptedModel([error]);
}

/** Never answers; rejects only when the call is aborted (timeout or caller). */
export function hangingModel() {
  return new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        // Like fetch: an already-aborted signal rejects straight away.
        if (abortSignal?.aborted) return reject(abortSignal.reason as Error);
        abortSignal?.addEventListener('abort', () => reject(abortSignal.reason as Error), {
          once: true,
        });
      }),
  });
}

/** The error the providers throw for an HTTP failure; 408/409/429/5xx are retryable. */
export function apiError(statusCode: number, responseHeaders?: Record<string, string>) {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://provider.test/v1/chat',
    requestBodyValues: {},
    statusCode,
    responseHeaders,
  });
}

/**
 * Deterministic vector for a text: same text, same vector, across runs. Not unit length,
 * so the code under test has to normalize it.
 */
export function fakeVector(text: string, dimensions = 1536) {
  let seed = createHash('sha256').update(text).digest().readUInt32LE(0);
  return Array.from({ length: dimensions }, () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 4 - 2;
  });
}

export const fakeEmbed = async ({ values }: { values: string[] }) => ({
  embeddings: values.map((value) => fakeVector(value)),
  warnings: [],
});

export const fakeEmbeddingModel = new MockEmbeddingModelV4({
  maxEmbeddingsPerCall: 100,
  doEmbed: fakeEmbed,
});
