import type { LanguageModelCallOptions } from 'ai';

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
};

export type TextRoute = {
  primary: ModelRef;
  fallback?: ModelRef;
  maxOutputTokens: number;
  temperature?: number;
  reasoning: NonNullable<LanguageModelCallOptions['reasoning']>;
  timeoutMs: number;
};

// Model ids checked against both providers' /models endpoints on 2026-10-23.
//
// Groq free tier: 8K tokens/min, 1K requests/day, ~200K tokens/day, counted per model,
// and only tokens actually used count (not maxOutputTokens). Splitting work between the
// two gpt-oss models doubles what we get. Llama models are enterprise-only on Groq now.
//
// Gemini free tier: limits are per project and shown in AI Studio, not in the API.
// gemini-3.7-flash and 3.8-flash are listed but never answered on the free tier (no
// response in 90s, 2026-10-23); 3.6 answers in ~3s at the same price.
// Exact ids only: the -latest aliases move to new models and would break eval comparisons.
const GPT_OSS_120B: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-120b' };
const GPT_OSS_20B: ModelRef = { provider: 'groq', model: 'openai/gpt-oss-20b' };
const GEMINI_FLASH: ModelRef = { provider: 'google', model: 'gemini-3.6-flash' };
const GEMINI_FLASH_LITE: ModelRef = { provider: 'google', model: 'gemini-3.5-flash-lite' };

// Reasoning tokens count toward maxOutputTokens, so the limits leave room for them.
export const textRoutes: Record<TextTask, TextRoute> = {
  agent: {
    primary: GPT_OSS_120B,
    fallback: GEMINI_FLASH,
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
  study: {
    primary: GPT_OSS_120B,
    fallback: GEMINI_FLASH,
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
  // Bulk work during ingestion: a book is far more than Groq's daily token limit, and
  // Gemini caches the document prefix these prompts repeat.
  contextualize: {
    primary: GEMINI_FLASH_LITE,
    fallback: GPT_OSS_20B,
    maxOutputTokens: 1_024,
    temperature: 0.2,
    reasoning: 'low',
    timeoutMs: 30_000,
  },
  summarize: {
    primary: GEMINI_FLASH_LITE,
    fallback: GPT_OSS_20B,
    maxOutputTokens: 2_048,
    temperature: 0.2,
    reasoning: 'low',
    timeoutMs: 30_000,
  },
  // No fallback: if the judge changed model halfway through an eval run, the scores in
  // that run couldn't be compared. A failed case is better than a mixed run.
  judge: {
    primary: GEMINI_FLASH,
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

// No fallback: vectors from different models can't be compared, so mixing them breaks
// the index.
export const embeddingRoute = {
  model: { provider: 'google', model: 'gemini-embedding-2' } satisfies ModelRef,
  dimensions: 1536,
  timeoutMs: 30_000,
};

/** The models to try for a task, in order. An override (used by evals) is tried alone. */
export function modelsFor(task: TextTask, override?: ModelRef): ModelRef[] {
  if (override) return [override];
  const { primary, fallback } = textRoutes[task];
  return fallback ? [primary, fallback] : [primary];
}
