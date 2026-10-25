import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import logger from '../../config/logger.config.js';
import {
  streamStep,
  type CallContext,
  type ChatMessage,
  type StreamedToolCall,
} from '../../llm/client.js';
import { isOpen } from '../../llm/circuitBreaker.js';
import { modelsFor, type ModelRef } from '../../llm/models.js';
import { AppError, UpstreamError } from '../../utils/errors/app.error.js';
import { neutralize } from '../citations/citationRegistry.js';
import { countTokens } from '../../utils/tokens.js';
import type { AgentTool, ToolContext } from './tools/tool.types.js';

export type AgentEvent =
  | { type: 'token'; text: string }
  | {
      type: 'step';
      index: number;
      tool: string;
      args: unknown;
      status: 'start' | 'end';
      ms?: number;
      summary?: string;
    };

/** One tool call as the assistant message stores it. */
export type SavedToolCall = {
  step: number;
  tool: string;
  args: unknown;
  ok: boolean;
  summary: string;
  ms: number;
  resultTokens: number;
};

export type AgentInput = {
  system: string;
  // Earlier turns as plain text, oldest first, already within the history budget.
  history: ChatMessage[];
  question: string;
  tools: readonly AgentTool[];
  ctx: ToolContext;
  callCtx: CallContext;
  onEvent: (event: AgentEvent) => void;
  // Filled in as the turn goes, so a failed turn can still save what it did.
  progress?: AgentProgress;
  // Evals: the models to use instead of the agent route (one model means no fallback), a
  // smaller input budget, and static RAG (one search with the question, then the answer).
  models?: ModelRef[];
  maxInputTokens?: number;
  staticRag?: boolean;
};

export type AgentProgress = { toolCalls: SavedToolCall[]; model?: ModelRef };

export type AgentResult = {
  answer: string;
  toolCalls: SavedToolCall[];
  steps: number;
  model: ModelRef;
  fallbackUsed: boolean;
  // The model was still calling tools when the steps ran out, so the last step forced an answer.
  forcedFinal: boolean;
  // Every search_sources call came back weak.
  weakRetrieval: boolean;
  firstTokenMs: number | null;
  toolMs: number;
};

type ToolRun = {
  call: StreamedToolCall;
  text: string;
  ok: boolean;
  weak?: boolean;
  // Replaced by a short note to keep the step under the input budget.
  dropped: boolean;
};

type Step = { response: ChatMessage[]; runs: ToolRun[] };

const DROPPED = '(Left out to save space. Call the tool again if you still need it.)';
const ARG_CHARS = 200;
const FINAL_NOTE =
  "You can't call tools any more. Answer now from the tool results above; if they aren't enough, say what is missing.";

/**
 * The chat agent: one streamed model call per step, the tools run here in between. A turn
 * sticks to the model that answered its first step. When that model fails before
 * answering a later step, the fallback gets the turn so far as plain text: one provider's
 * tool calls are never replayed to another. The last step always runs without tools.
 */
export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const { ctx, onEvent } = input;
  const started = performance.now();
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const toolSet: ToolSet = Object.fromEntries(
    input.tools.map((t) => [t.name, tool({ description: t.description, inputSchema: t.input })]),
  );

  const route = input.models?.length ? input.models : modelsFor('agent');
  const maxInputTokens = input.maxInputTokens ?? appConfig.chat.maxInputTokens;
  // Models with an open circuit breaker go last rather than first.
  let models = [...route.filter((ref) => !isOpen(ref)), ...route.filter((ref) => isOpen(ref))];
  // Set once the turn changes model after a tool step: from then on it is sent as text.
  let flattened = false;
  const steps: Step[] = [];
  const saved: SavedToolCall[] = input.progress?.toolCalls ?? [];
  let answer = '';
  let separate = false;
  let firstTokenMs: number | null = null;
  let toolMs = 0;

  const onText = (text: string) => {
    if (!text) return;
    // Text from an earlier step ("Let me look that up") stays, set apart from the next.
    if (separate && answer && !answer.endsWith('\n')) {
      answer += '\n\n';
      onEvent({ type: 'token', text: '\n\n' });
    }
    separate = false;
    firstTokenMs ??= Math.round(performance.now() - started);
    answer += text;
    onEvent({ type: 'token', text });
  };

  const callModel = async (final: boolean) => {
    for (;;) {
      const build = (history: ChatMessage[]) =>
        final || flattened
          ? flatMessages(history, input.question, steps, final)
          : nativeMessages(history, input.question, steps);
      try {
        return await streamStep({
          task: 'agent',
          instructions: input.system,
          messages: fitBudget(maxInputTokens, input.system, input.history, steps, build),
          tools: final ? undefined : toolSet,
          models: [models[0]!],
          fallbackUsed: models[0] !== route[0],
          onText,
          abortSignal: ctx.signal,
          ctx: input.callCtx,
        });
      } catch (error) {
        if (ctx.signal?.aborted || models.length < 2 || !beforeOutput(error)) throw error;
        models = models.slice(1);
        if (steps.length > 0) flattened = true;
      }
    }
  };

  const callTool = async (index: number, call: StreamedToolCall) => {
    const runStarted = performance.now();
    const args = safeArgs(call.input);
    onEvent({ type: 'step', index, tool: call.toolName, args, status: 'start' });
    const { run, summary } = await runTool(byName.get(call.toolName), call, ctx);
    const ms = Math.round(performance.now() - runStarted);
    toolMs += ms;
    saved.push({
      step: index,
      tool: call.toolName,
      args,
      ok: run.ok,
      summary,
      ms,
      resultTokens: countTokens(run.text),
    });
    onEvent({ type: 'step', index, tool: call.toolName, args, status: 'end', ms, summary });
    return run;
  };

  let stepCount = 0;
  if (input.staticRag) {
    // No choices for the model: search with the question as asked, then answer.
    const query = input.question.slice(0, appConfig.retrieval.maxQueryChars);
    const call = { toolCallId: 'static-search', toolName: 'search_sources', input: { query } };
    steps.push({ response: [], runs: [await callTool(1, call)] });
    const result = await callModel(true);
    if (input.progress) input.progress.model = result.model;
    stepCount = 2;
  }

  for (let index = 1; !input.staticRag && index <= appConfig.chat.maxAgentSteps; index++) {
    // Reaching the last step means the model was still calling tools: it now has to answer.
    const final = index === appConfig.chat.maxAgentSteps;
    stepCount = index;
    const result = await callModel(final);
    if (input.progress) input.progress.model = result.model;
    if (final || result.toolCalls.length === 0) break;

    const runs: ToolRun[] = [];
    for (const [position, call] of result.toolCalls.entries()) {
      if (ctx.signal?.aborted) throw ctx.signal.reason;
      if (position >= appConfig.chat.maxToolCallsPerStep) {
        runs.push({
          call,
          text: 'Not run: too many tool calls in one step.',
          ok: false,
          dropped: false,
        });
        continue;
      }
      runs.push(await callTool(index, call));
    }
    steps.push({ response: result.responseMessages, runs });
    separate = true;
  }

  // Nothing to show (e.g. the output budget went on reasoning): a failed turn, not an answer.
  if (!answer.trim()) throw new UpstreamError('LLM', { task: 'agent', emptyAnswer: true });

  const searches = steps.flatMap((step) =>
    step.runs.filter((run) => run.call.toolName === 'search_sources' && run.ok),
  );
  return {
    answer,
    toolCalls: saved,
    steps: stepCount,
    model: models[0]!,
    fallbackUsed: models[0] !== route[0],
    forcedFinal: !input.staticRag && stepCount === appConfig.chat.maxAgentSteps,
    weakRetrieval: searches.length > 0 && searches.every((run) => run.weak),
    firstTokenMs,
    toolMs,
  };
}

/** A failure the next model can take over: nothing reached the client yet. */
function beforeOutput(error: unknown) {
  if (!(error instanceof UpstreamError)) return false;
  const details = error.details as { interrupted?: boolean } | undefined;
  return !details?.interrupted;
}

async function runTool(
  agentTool: AgentTool | undefined,
  call: StreamedToolCall,
  ctx: ToolContext,
): Promise<{ run: ToolRun; summary: string }> {
  const failed = (text: string) => ({
    run: { call, text, ok: false, dropped: false },
    summary: text,
  });
  if (!agentTool) return failed(`There is no tool called "${call.toolName}".`);
  const parsed = agentTool.input.safeParse(call.input);
  if (!parsed.success) return failed(`Invalid arguments: ${z.prettifyError(parsed.error)}`);
  try {
    const result = await agentTool.execute(parsed.data, ctx);
    return {
      run: { call, text: result.text, ok: true, weak: result.weak, dropped: false },
      summary: result.summary,
    };
  } catch (error) {
    if (ctx.signal?.aborted) throw error;
    // Our own errors (source not found, limit reached) are safe to show; anything else isn't.
    if (error instanceof AppError && error.statusCode < 500) {
      return failed(`The tool failed: ${error.message}`);
    }
    logger.error('Agent tool failed', { tool: call.toolName, error });
    return failed('The tool failed with an internal error.');
  }
}

/** The arguments as events and saved messages show them: long strings cut short. */
function safeArgs(input: unknown): unknown {
  if (typeof input === 'string') {
    return input.length > ARG_CHARS ? `${input.slice(0, ARG_CHARS)}…` : input;
  }
  if (Array.isArray(input)) return input.slice(0, 20).map(safeArgs);
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input)
        .slice(0, 20)
        .map(([key, value]) => [key, safeArgs(value)]),
    );
  }
  return input;
}

function resultText(run: ToolRun) {
  return run.dropped ? DROPPED : run.text;
}

/** The turn in the provider's own tool-call format, for the model that made the calls. */
function nativeMessages(history: ChatMessage[], question: string, steps: Step[]): ChatMessage[] {
  const messages: ChatMessage[] = [...history, { role: 'user', content: question }];
  for (const step of steps) {
    messages.push(...step.response);
    messages.push({
      role: 'tool',
      content: step.runs.map((run) => ({
        type: 'tool-result' as const,
        toolCallId: run.call.toolCallId,
        toolName: run.call.toolName,
        output: { type: 'text' as const, value: resultText(run) },
      })),
    });
  }
  return messages;
}

/** The turn as plain text: tool results go in the user message after the question. */
function flatMessages(
  history: ChatMessage[],
  question: string,
  steps: Step[],
  final: boolean,
): ChatMessage[] {
  const results = steps.flatMap((step) =>
    step.runs.map(
      (run) =>
        `<tool_result tool="${escapeAttr(run.call.toolName)}" args="${escapeAttr(JSON.stringify(safeArgs(run.call.input)))}">\n${neutralize(resultText(run))}\n</tool_result>`,
    ),
  );
  const parts = [question];
  if (results.length > 0)
    parts.push(`Results of the tools called so far:\n\n${results.join('\n\n')}`);
  if (final) parts.push(FINAL_NOTE);
  return [...history, { role: 'user', content: parts.join('\n\n') }];
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function messageTokens(message: ChatMessage) {
  return countTokens(
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
  );
}

/**
 * Keeps one step's input under `maxInputTokens`: drops the oldest history first (so it
 * still starts at a user message), then replaces the oldest tool results with a note.
 */
function fitBudget(
  maxInputTokens: number,
  system: string,
  history: ChatMessage[],
  steps: Step[],
  build: (history: ChatMessage[]) => ChatMessage[],
): ChatMessage[] {
  const budget = maxInputTokens - countTokens(system);
  const total = (list: ChatMessage[]) => list.reduce((sum, m) => sum + messageTokens(m), 0);
  let kept = history;
  let messages = build(kept);
  while (total(messages) > budget && kept.length > 0) {
    let cut = 1;
    while (cut < kept.length && kept[cut]!.role !== 'user') cut += 1;
    kept = kept.slice(cut);
    messages = build(kept);
  }
  // A dropped result stays dropped for the rest of the turn.
  for (const run of steps.flatMap((step) => step.runs)) {
    if (total(messages) <= budget) break;
    if (run.dropped) continue;
    run.dropped = true;
    messages = build(kept);
  }
  return messages;
}
