import type { LanguageModelCallOptions } from 'ai';
import { serverConfig } from '../config/index.js';

export const TASKS = [
  'answer',
  'agent',
  'study',
  'cheap',
  'contextualize',
  'summarize',
  'memory',
  'rewrite',
  'judge',
  'longContext',
  'embed',
] as const;

export type Task = (typeof TASKS)[number];
export type TextTask = Exclude<Task, 'embed'>;

export type ProviderName = 'groq' | 'google';

export type ModelRef = {
  provider: ProviderName;
  model: string;
  // Which of the provider's keys to call it with, counted from 0; unset for the first. The
  // keys come from different projects and free-tier quotas are per project, so a model
  // whose quota is out on one key still answers on the next.
  key?: number;
};

export type TextRoute = {
  primary: ModelRef;
  fallback?: ModelRef;
  maxOutputTokens: number;
  temperature?: number;
  reasoning: NonNullable<LanguageModelCallOptions['reasoning']>;
  timeoutMs: number;
};

// Groq free tier: 8K tokens/min, 1K requests/day, ~200K tokens/day, counted per model,
// and only tokens actually used count (not maxOutputTokens). Splitting work between the
// two gpt-oss models doubles the budget. Llama models are enterprise-only on Groq.
//
// Gemini free tier: limits are per project and shown in AI Studio, not in the API.
// gemini-3.7-flash and 3.8-flash are listed but don't answer on the free tier, so 3.6 is used.
// Exact ids only: the -latest aliases move to new models and would break eval comparisons.
const GPT_OSS_120B: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-120b' };
const GPT_OSS_20B: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-20b' };
const GEMINI_FLASH: ModelRef = { provider: 'google', model: 'gemini-3.6-flash' };
const GEMINI_FLASH_LITE: ModelRef = { provider: 'google', model: 'gemini-3.5-flash-lite' };

// Reasoning tokens count toward maxOutputTokens, so the limits leave room for them.
export const textRoutes: Record<TextTask, TextRoute> = {
  // Gemini first: every agent step re-sends the whole context, and Groq's free tier allows
  // only 8K tokens a minute per model; Gemini's limits count requests instead.
  agent: {
    primary: GEMINI_FLASH,
    fallback: GPT_OSS_120B,
    maxOutputTokens: 4_096,
    temperature: 0.2,
    reasoning: 'medium',
    timeoutMs: 60_000,
  },
  answer: {
    primary: GPT_OSS_120B,
    fallback: GEMINI_FLASH,
    maxOutputTokens: 4_096,
    temperature: 0.2,
    reasoning: 'medium',
    timeoutMs: 60_000,
  },
  // One generation can be 8K tokens of output alone: more than Groq's minute allows.
  study: {
    primary: GEMINI_FLASH,
    fallback: GPT_OSS_120B,
    maxOutputTokens: 8_192,
    temperature: 0.7,
    reasoning: 'medium',
    timeoutMs: 60_000,
  },
  cheap: {
    primary: GPT_OSS_20B,
    fallback: GEMINI_FLASH_LITE,
    maxOutputTokens: 1_024,
    temperature: 0,
    reasoning: 'low',
    timeoutMs: 20_000,
  },
  rewrite: {
    primary: GPT_OSS_20B,
    fallback: GEMINI_FLASH_LITE,
    maxOutputTokens: 1_024,
    temperature: 0,
    reasoning: 'low',
    timeoutMs: 20_000,
  },
  memory: {
    primary: GPT_OSS_20B,
    fallback: GEMINI_FLASH_LITE,
    maxOutputTokens: 1_024,
    temperature: 0,
    reasoning: 'low',
    timeoutMs: 20_000,
  },
  // Bulk work during ingestion: a book is far more than Groq's daily token limit. No
  // fallback: gpt-oss-20b serves cheap/rewrite/memory, and one book would use up its day.
  // A chunk whose context fails is still indexed, just without one.
  contextualize: {
    primary: GEMINI_FLASH_LITE,
    // One call writes the contexts for all children of a parent (5-6) or a pack of code
    // chunks (up to 8), plus reasoning.
    maxOutputTokens: 3_072,
    temperature: 0.2,
    reasoning: 'low',
    timeoutMs: 45_000,
  },
  // Long inputs too, but occasional, so Groq can step in.
  summarize: {
    primary: GEMINI_FLASH_LITE,
    fallback: GPT_OSS_20B,
    maxOutputTokens: 2_048,
    temperature: 0.2,
    reasoning: 'low',
    timeoutMs: 30_000,
  },
  // No fallback: if the judge changed model halfway through an eval run, the scores in
  // that run couldn't be compared. A failed case is better than a mixed run. Not the agent's
  // model (a judge favours its own answers), and not Groq: a judge call with its passages
  // can pass Groq's 8K tokens a minute on its own.
  judge: {
    primary: GEMINI_FLASH_LITE,
    maxOutputTokens: 2_048,
    temperature: 0,
    reasoning: 'medium',
    timeoutMs: 60_000,
  },
  longContext: {
    primary: GEMINI_FLASH,
    maxOutputTokens: 4_096,
    temperature: 0.2,
    reasoning: 'low',
    timeoutMs: 90_000,
  },
};

// Documents and queries are embedded differently so a short question lands near the
// passage that answers it.
export type EmbedKind = 'document' | 'query';

// No fallback: vectors from different models can't be compared, so mixing them breaks
// the index. Everything specific to the model is here, so switching models only touches
// this route (the database column is vector(1536), so a model with other dimensions also
// needs a migration).
export const embeddingRoute = {
  model: { provider: 'google', model: 'gemini-embedding-2' } satisfies ModelRef,
  dimensions: 1536,
  timeoutMs: 30_000,
  // gemini-embedding-2 takes the task as a text prefix (it has no taskType option); a
  // document's title gives it context.
  input(text: string, kind: EmbedKind, title?: string) {
    return kind === 'query'
      ? `task: search result | query: ${text}`
      : `title: ${title?.trim() || 'none'} | text: ${text}`;
  },
  // Gemini reports no token counts for embeddings; ~4 characters per token is close enough.
  estimateTokens(input: string) {
    return Math.ceil(input.length / 4);
  },
};

/** A key's number counted from 1, as saved on usage rows: undefined for the first key. */
export const keyLabel = (key: number | undefined) => (key ? String(key + 1) : undefined);

/** "provider/model", plus "#2", "#3"... for the other keys: for logs and per-model state. */
export function modelLabel(ref: ModelRef) {
  const key = keyLabel(ref.key);
  return `${ref.provider}/${ref.model}${key ? `#${key}` : ''}`;
}

export type KeyCounts = Record<ProviderName, number>;

export const keyCounts = (): KeyCounts => ({
  groq: serverConfig.GROQ_API_KEYS.length,
  google: serverConfig.GEMINI_API_KEYS.length,
});

/**
 * Puts a copy of each model for every other key of its provider right after it, so the
 * same model is tried on each key before the next model.
 */
export function withEveryKey(refs: ModelRef[], counts: KeyCounts): ModelRef[] {
  return refs.flatMap((ref) => [
    ref,
    ...Array.from({ length: Math.max(0, counts[ref.provider] - 1) }, (_, i) => ({
      ...ref,
      key: i + 1,
    })),
  ]);
}

/**
 * Rotates each model's run of key copies to start at key `start` (wrapping round when the
 * provider has fewer keys), so bulk work can spread its calls over every key. The models
 * keep their order.
 */
export function startingAtKey(refs: ModelRef[], start: number): ModelRef[] {
  const out: ModelRef[] = [];
  let i = 0;
  while (i < refs.length) {
    const first = refs[i]!;
    let end = i + 1;
    while (refs[end]?.provider === first.provider && refs[end]?.model === first.model) end++;
    const run = refs.slice(i, end);
    const at = start % run.length;
    out.push(...run.slice(at), ...run.slice(0, at));
    i = end;
  }
  return out;
}

/** The models to try for a task, in order. An override (used by evals) is tried alone. */
export function modelsFor(task: TextTask, override?: ModelRef): ModelRef[] {
  if (override) return [override];
  const { primary, fallback } = textRoutes[task];
  return withEveryKey(fallback ? [primary, fallback] : [primary], keyCounts());
}
