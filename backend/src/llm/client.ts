import {
  generateText,
  NoObjectGeneratedError,
  Output,
  streamText,
  type FlexibleSchema,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type StopCondition,
  type SystemModelMessage,
  type ToolSet,
} from 'ai';
import { appConfig } from '../config/app.config.js';
import logger from '../config/logger.config.js';
import { Prisma } from '../generated/prisma/client.js';
import { UpstreamError } from '../utils/errors/app.error.js';
import {
  backupFirst,
  modelLabel,
  modelsFor,
  textRoutes,
  type ModelRef,
  type TextRoute,
  type TextTask,
} from './models.js';
import { isOpen, isQuotaError, noteQuotaError } from './circuitBreaker.js';
import { estimateCost, type TokenCounts } from './pricing.js';
import { languageModel } from './providers.js';
import { describeError, quotaHits, withRetry } from './retry.js';
import { recordUsage } from './usage.repository.js';

export type CallContext = {
  userId?: string;
  workspaceId?: string;
  messageId?: string;
};

// System text only goes through `instructions`. The SDK also rejects system messages inside
// `messages` at runtime, so user-supplied history can't smuggle one in.
export type ChatMessage = Exclude<ModelMessage, SystemModelMessage>;

type PromptInput = { instructions?: string } & (
  { prompt: string; messages?: never } | { messages: ChatMessage[]; prompt?: never }
);

type CallOptions = PromptInput & {
  task: TextTask;
  // Evals pin a model to compare models; an override is tried alone, without fallback.
  modelOverride?: ModelRef;
  // Bulk work that spreads its calls over both Gemini keys starts some on the backup key.
  startWith?: 'backup';
  // Waits before each model is tried, for callers that pace their calls to a key's rate.
  pace?: (ref: ModelRef) => Promise<void>;
  abortSignal?: AbortSignal;
  ctx?: CallContext;
};

/** What one call cost and which model answered. Returned to callers and saved as a UsageEvent. */
export type CallInfo = TokenCounts & {
  provider: string;
  model: string;
  // Set when the backup Gemini key answered.
  key?: 'backup';
  fallbackUsed: boolean;
  costUsd: Prisma.Decimal;
  latencyMs: number;
};

type Attempt<T> = (
  model: LanguageModel,
  route: TextRoute,
  signal: AbortSignal,
) => Promise<{ value: T; usage: LanguageModelUsage }>;

export async function generate<TOOLS extends ToolSet = ToolSet>(
  options: CallOptions & {
    tools?: TOOLS;
    stopWhen?: StopCondition<NoInfer<TOOLS>> | StopCondition<NoInfer<TOOLS>>[];
  },
) {
  const { tools, stopWhen } = options;
  const { value: result, call } = await callWithFallback(options, async (model, route, signal) => {
    const result = await generateText({
      model,
      ...promptFields(options),
      tools,
      stopWhen,
      ...settingsFor(route),
      abortSignal: signal,
    });
    return { value: result, usage: result.usage };
  });
  return { text: result.text, result, call };
}

/** Structured output validated against `schema` (zod works). Built on generateText + Output.object. */
export async function generateObject<OBJECT>(
  options: CallOptions & { schema: FlexibleSchema<OBJECT>; schemaName?: string },
) {
  const { value: object, call } = await callWithFallback(options, async (model, route, signal) => {
    const result = await generateText({
      model,
      ...promptFields(options),
      output: Output.object({ schema: options.schema, name: options.schemaName }),
      ...settingsFor(route),
      abortSignal: signal,
    });
    return { value: result.output, usage: result.usage };
  });
  return { object, call };
}

export type StreamedToolCall = { toolCallId: string; toolName: string; input: unknown };

export type StreamStepResult = {
  text: string;
  toolCalls: StreamedToolCall[];
  // The assistant (and tool-call) messages to append before the next step.
  responseMessages: ChatMessage[];
  model: ModelRef;
  call: CallInfo;
};

// Thrown when a stream fails after the client already saw part of it: retrying or falling
// back would send the same text twice, so the step ends here.
class StreamInterruptedError extends Error {
  constructor(cause: unknown) {
    super(`Stream interrupted: ${describeError(cause)}`, { cause });
    this.name = 'StreamInterruptedError';
  }
}

/**
 * One streamed model call, for the agent's step loop. Text goes to `onText` as it arrives;
 * tool calls come back for the caller to run (its tools have no `execute`). Retries and the
 * fallback only apply until the first output. `models` overrides the task's route, so a
 * turn can stick to the model that started it.
 */
export async function streamStep(
  options: CallOptions & {
    tools?: ToolSet;
    models?: ModelRef[];
    // The caller already moved past its primary model (the agent passes one model a step).
    fallbackUsed?: boolean;
    // The caller has another model to try if these fail.
    hasFallback?: boolean;
    onText: (delta: string) => void;
  },
): Promise<StreamStepResult> {
  const { task, abortSignal, ctx } = options;
  const route = textRoutes[task];
  const models = options.models ?? modelsFor(task, options.modelOverride);
  const started = performance.now();
  logPrompt(options, models);

  let emitted = false;
  let lastError: unknown;
  let lastIndex = 0;
  for (const [index, ref] of models.entries()) {
    if (skipOpen(ref, index, models.length, task)) continue;
    lastIndex = index;
    const hasFallback = index < models.length - 1 || options.hasFallback === true;
    try {
      const value = await withRetry(
        async (signal) => {
          const result = streamText({
            model: languageModel(ref),
            ...promptFields(options),
            tools: options.tools,
            ...settingsFor(route),
            abortSignal: signal,
            // The SDK prints stream errors to the console by default; they reach the loop
            // below as error parts and are retried, passed to the fallback or logged there.
            onError: () => {},
          });
          try {
            for await (const part of result.fullStream) {
              if (part.type === 'text-delta') {
                emitted = true;
                options.onText(part.text);
              } else if (part.type === 'tool-call') {
                emitted = true;
              } else if (part.type === 'error') {
                throw part.error;
              }
            }
          } catch (error) {
            throw emitted ? new StreamInterruptedError(error) : error;
          }
          const [text, toolCalls, responseMessages, usage] = await Promise.all([
            result.text,
            result.toolCalls,
            result.responseMessages,
            result.usage,
          ]);
          return { text, toolCalls, responseMessages, usage };
        },
        { timeoutMs: route.timeoutMs, signal: abortSignal, hasFallback },
      );
      const fellBack = index > 0 || options.fallbackUsed === true;
      const call = callInfo(ref, tokenCounts(value.usage), NO_SPENT, fellBack, started);
      await recordUsage({ ...usageRow(task, call, ctx), ok: true });
      return {
        text: value.text,
        toolCalls: value.toolCalls.map(({ toolCallId, toolName, input }) => ({
          toolCallId,
          toolName,
          input,
        })),
        responseMessages: value.responseMessages as ChatMessage[],
        model: ref,
        call,
      };
    } catch (error) {
      lastError = error;
      if (isQuotaError(error)) noteQuotaError(ref);
      if (abortSignal?.aborted || emitted) break;
      logFailure(task, ref, error, hasFallback);
    }
  }

  const fellBack = lastIndex > 0 || options.fallbackUsed === true;
  const call = callInfo(models[lastIndex]!, NO_TOKENS, NO_SPENT, fellBack, started);
  await recordUsage({ ...usageRow(task, call, ctx), ok: false, error: describeError(lastError) });
  if (abortSignal?.aborted) throw abortSignal.reason;
  throw new UpstreamError('LLM', { task, interrupted: emitted }, { cause: lastError });
}

function logFailure(task: TextTask, ref: ModelRef, error: unknown, willFallBack: boolean) {
  const quota = quotaHits(error);
  logger.warn('Model call failed', {
    task,
    model: modelLabel(ref),
    error: describeError(error),
    ...(quota.length > 0 && { quota }),
    willFallBack,
  });
}

// A model whose quota keeps running out is skipped while its breaker is open, unless it is
// the last one left: trying it beats failing without a call.
function skipOpen(ref: ModelRef, index: number, count: number, task: TextTask) {
  if (index === count - 1 || !isOpen(ref)) return false;
  logger.debug('Skipping a model with an open circuit breaker', {
    task,
    model: modelLabel(ref),
  });
  return true;
}

/**
 * Tries the task's primary model (with retries), then its fallback. Writes one UsageEvent
 * either way. When every model fails the caller gets UPSTREAM_ERROR; the provider's own
 * error only goes to the log.
 */
async function callWithFallback<T>(options: CallOptions, attempt: Attempt<T>) {
  const { task, modelOverride, abortSignal, ctx } = options;
  const route = textRoutes[task];
  const routed = modelsFor(task, modelOverride);
  const models = options.startWith === 'backup' ? backupFirst(routed) : routed;
  const started = performance.now();
  logPrompt(options, models);

  let lastError: unknown;
  let lastIndex = 0;
  // Tokens a failed attempt still used (e.g. output that didn't match the schema), priced
  // at the model that used them and added to the call's totals.
  let spent: Spent = { tokens: NO_TOKENS, costUsd: new Prisma.Decimal(0) };
  for (const [index, ref] of models.entries()) {
    if (skipOpen(ref, index, models.length, task)) continue;
    lastIndex = index;
    const hasFallback = index < models.length - 1;
    try {
      await options.pace?.(ref);
      const { value, usage } = await withRetry(
        (signal) => attempt(languageModel(ref), route, signal),
        { timeoutMs: route.timeoutMs, signal: abortSignal, hasFallback },
      );
      const call = callInfo(ref, tokenCounts(usage), spent, index > 0, started);
      await recordUsage({ ...usageRow(task, call, ctx), ok: true });
      return { value, call };
    } catch (error) {
      lastError = error;
      if (isQuotaError(error)) noteQuotaError(ref);
      // Only structured-output failures report usage; a timed-out call's tokens are unknown.
      if (NoObjectGeneratedError.isInstance(error) && error.usage) {
        const tokens = tokenCounts(error.usage);
        spent = {
          tokens: addTokens(spent.tokens, tokens),
          costUsd: spent.costUsd.add(estimateCost(ref.model, tokens)),
        };
      }
      // The client went away: nobody is waiting for a fallback answer.
      if (abortSignal?.aborted) break;
      logFailure(task, ref, error, hasFallback);
    }
  }

  // Recorded against the last model tried, which is the primary when the caller aborted.
  const call = callInfo(models[lastIndex]!, NO_TOKENS, spent, lastIndex > 0, started);
  await recordUsage({ ...usageRow(task, call, ctx), ok: false, error: describeError(lastError) });

  if (abortSignal?.aborted) throw abortSignal.reason;
  throw new UpstreamError('LLM', { task }, { cause: lastError });
}

function promptFields(options: PromptInput) {
  return options.messages
    ? { instructions: options.instructions, messages: options.messages }
    : { instructions: options.instructions, prompt: options.prompt };
}

function settingsFor(route: TextRoute) {
  return {
    maxOutputTokens: route.maxOutputTokens,
    temperature: route.temperature,
    reasoning: route.reasoning,
    // Retries are ours (retry.ts): the SDK's wait up to 60s on retry-after.
    maxRetries: 0,
  };
}

const NO_TOKENS: TokenCounts = { tokensIn: 0, tokensOut: 0, tokensCached: 0 };
const NO_SPENT: Spent = { tokens: NO_TOKENS, costUsd: new Prisma.Decimal(0) };

type Spent = { tokens: TokenCounts; costUsd: Prisma.Decimal };

function tokenCounts(usage: LanguageModelUsage): TokenCounts {
  return {
    tokensIn: usage.inputTokens ?? 0,
    tokensOut: usage.outputTokens ?? 0,
    tokensCached: usage.inputTokenDetails.cacheReadTokens ?? 0,
  };
}

function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    tokensCached: a.tokensCached + b.tokensCached,
  };
}

function callInfo(
  ref: ModelRef,
  tokens: TokenCounts,
  spent: Spent,
  fallbackUsed: boolean,
  started: number,
): CallInfo {
  return {
    provider: ref.provider,
    model: ref.model,
    ...(ref.key && { key: ref.key }),
    fallbackUsed,
    ...addTokens(spent.tokens, tokens),
    costUsd: spent.costUsd.add(estimateCost(ref.model, tokens)),
    latencyMs: Math.round(performance.now() - started),
  };
}

function usageRow(task: TextTask, call: CallInfo, ctx: CallContext | undefined) {
  return {
    type: 'LLM' as const,
    task,
    userId: ctx?.userId,
    workspaceId: ctx?.workspaceId,
    messageId: ctx?.messageId,
    provider: call.provider,
    model: call.model,
    key: call.key,
    tokensIn: call.tokensIn,
    tokensOut: call.tokensOut,
    tokensCached: call.tokensCached,
    costUsd: call.costUsd,
    latencyMs: call.latencyMs,
    fallbackUsed: call.fallbackUsed,
  };
}

// Prompts hold user data, so they're only logged at debug level and cut short.
function logPrompt(options: CallOptions, models: ModelRef[]) {
  if (!logger.isDebugEnabled()) return;
  const text = options.prompt ?? JSON.stringify(options.messages);
  logger.debug('Model call', {
    task: options.task,
    models: models.map(modelLabel),
    prompt: text.slice(0, appConfig.llm.logPreviewChars),
  });
}
