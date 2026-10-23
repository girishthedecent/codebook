import {
  generateText,
  NoObjectGeneratedError,
  Output,
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
import { modelsFor, textRoutes, type ModelRef, type TextRoute, type TextTask } from './models.js';
import { estimateCost, type TokenCounts } from './pricing.js';
import { languageModel } from './providers.js';
import { describeError, withRetry } from './retry.js';
import { recordUsage } from './usage.repository.js';

export type CallContext = {
  userId?: string;
  workspaceId?: string;
};

// System text only goes through `instructions`. The SDK also rejects system messages inside
// `messages` at runtime, so user-supplied history can't smuggle one in.
type ChatMessage = Exclude<ModelMessage, SystemModelMessage>;

type PromptInput = { instructions?: string } & (
  { prompt: string; messages?: never } | { messages: ChatMessage[]; prompt?: never }
);

type CallOptions = PromptInput & {
  task: TextTask;
  // Evals pin a model to compare models; an override is tried alone, without fallback.
  modelOverride?: ModelRef;
  abortSignal?: AbortSignal;
  ctx?: CallContext;
};

/** What one call cost and which model answered. Returned to callers and saved as a UsageEvent. */
export type CallInfo = TokenCounts & {
  provider: string;
  model: string;
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

/**
 * Tries the task's primary model (with retries), then its fallback. Writes one UsageEvent
 * either way. When every model fails the caller gets UPSTREAM_ERROR; the provider's own
 * error only goes to the log.
 */
async function callWithFallback<T>(options: CallOptions, attempt: Attempt<T>) {
  const { task, modelOverride, abortSignal, ctx } = options;
  const route = textRoutes[task];
  const models = modelsFor(task, modelOverride);
  const started = performance.now();
  logPrompt(options);

  let lastError: unknown;
  let lastIndex = 0;
  // Tokens a failed attempt still used (e.g. output that didn't match the schema), priced
  // at the model that used them and added to the call's totals.
  let spent: Spent = { tokens: NO_TOKENS, costUsd: new Prisma.Decimal(0) };
  for (const [index, ref] of models.entries()) {
    lastIndex = index;
    try {
      const { value, usage } = await withRetry(
        (signal) => attempt(languageModel(ref), route, signal),
        { timeoutMs: route.timeoutMs, signal: abortSignal },
      );
      const call = callInfo(ref, tokenCounts(usage), spent, index > 0, started);
      await recordUsage({ ...usageRow(task, call, ctx), ok: true });
      return { value, call };
    } catch (error) {
      lastError = error;
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
      logger.warn('Model call failed', {
        task,
        provider: ref.provider,
        model: ref.model,
        error: describeError(error),
        willFallBack: index < models.length - 1,
      });
    }
  }

  // Recorded against the last model tried, which is the primary when the caller aborted.
  const call = callInfo(models[lastIndex]!, NO_TOKENS, spent, lastIndex > 0, started);
  await recordUsage({ ...usageRow(task, call, ctx), ok: false, error: describeError(lastError) });

  if (abortSignal?.aborted) throw abortSignal.reason;
  throw new UpstreamError('LLM', { task });
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
    provider: call.provider,
    model: call.model,
    tokensIn: call.tokensIn,
    tokensOut: call.tokensOut,
    tokensCached: call.tokensCached,
    costUsd: call.costUsd,
    latencyMs: call.latencyMs,
    fallbackUsed: call.fallbackUsed,
  };
}

// Prompts hold user data, so they're only logged at debug level and cut short.
function logPrompt(options: CallOptions) {
  if (!logger.isDebugEnabled()) return;
  const text = options.prompt ?? JSON.stringify(options.messages);
  logger.debug('Model call', {
    task: options.task,
    prompt: text.slice(0, appConfig.llm.logPreviewChars),
  });
}
