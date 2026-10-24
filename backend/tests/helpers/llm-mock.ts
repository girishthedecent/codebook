import { createHash } from 'node:crypto';
import { APICallError } from 'ai';
import { convertArrayToReadableStream, MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
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

/**
 * Answers each call with `answer(prompt)`, given the call's prompt text; an Error is thrown.
 * For models whose reply depends on what they were sent.
 */
export function promptModel(answer: (prompt: string) => string | Error) {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const text = prompt
        .flatMap((message) =>
          typeof message.content === 'string'
            ? [message.content]
            : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
        )
        .join('\n');
      const reply = answer(text);
      if (reply instanceof Error) throw reply;
      return {
        content: [{ type: 'text', text: reply }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: usage(100, 20),
        warnings: [],
      };
    },
  });
}

export type StreamTurn =
  | Error
  | {
      text?: string;
      toolCalls?: { name: string; input: unknown }[];
      // Sent after the text: the stream breaks once the client has seen part of it.
      failAfterText?: Error;
    };

/**
 * A streaming model for the agent loop: plays `turns` in order, one per call, repeating
 * the last. Text arrives a word at a time; tool calls come after it.
 */
export function streamingModel(turns: StreamTurn[], tokens: Tokens = { input: 100, output: 20 }) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const turn = turns[Math.min(call++, turns.length - 1)]!;
      if (turn instanceof Error) throw turn;
      const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
      if (turn.text) {
        parts.push({ type: 'text-start', id: 't' });
        for (const word of turn.text.split(/(?<= )/)) {
          parts.push({ type: 'text-delta', id: 't', delta: word });
        }
        parts.push({ type: 'text-end', id: 't' });
      }
      if (turn.failAfterText) parts.push({ type: 'error', error: turn.failAfterText });
      const toolCalls = turn.toolCalls ?? [];
      toolCalls.forEach((toolCall, i) =>
        parts.push({
          type: 'tool-call',
          toolCallId: `call-${call}-${i}`,
          toolName: toolCall.name,
          input: JSON.stringify(toolCall.input),
        }),
      );
      parts.push({
        type: 'finish',
        finishReason: { unified: toolCalls.length > 0 ? 'tool-calls' : 'stop', raw: undefined },
        usage: usage(tokens.input, tokens.output, tokens.cached),
      });
      return { stream: convertArrayToReadableStream(parts as never[]) };
    },
  });
}

/** Streams `text`, then waits until the call is aborted. */
export function stallingStreamModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 't' });
          controller.enqueue({ type: 'text-delta', id: 't', delta: text });
          abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason), {
            once: true,
          });
        },
      }),
    }),
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
