import { z } from 'zod';
import { EvalCaseType } from '../src/generated/prisma/enums.js';
import { textRoutes, type ModelRef } from '../src/llm/models.js';
import { DEFAULT_AGENT_PROMPT, agentSystemPrompts } from '../src/llm/prompts/agentSystem.js';
import { agentTools } from '../src/modules/chat/tools/index.js';
import { configNames, readConfig } from './config.js';
import { CORPUS_VARIANTS } from './corpusWorkspace.js';

// An answer eval config: evals/configs/answer/<name>.json. Each one is a way of answering
// (static RAG, the agent with some tools, another model or prompt, the whole corpus in one
// prompt) run over the same cases with the same judge.

export const ANSWER_CONFIG_DIR = 'evals/configs/answer';

// The web is left out of every config: its results change from day to day and come out of
// a monthly quota, so runs that used it couldn't be compared.
const EVAL_TOOLS = agentTools.map((tool) => tool.name).filter((name) => name !== 'web_search');

const modelRefSchema = z.strictObject({
  provider: z.enum(['groq', 'google']),
  model: z.string().min(1),
});

export const answerConfigSchema = z
  .strictObject({
    name: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string().optional(),
    corpus: z.enum(CORPUS_VARIANTS).default('context'),
    // agent: the chat agent; static: one search with the question, then the answer;
    // longContext: no retrieval, the corpus text itself in the prompt.
    mode: z.enum(['agent', 'static', 'longContext']).default('agent'),
    // The one model that answers: no fallback, so a run never mixes models. Defaults to the
    // route's primary (agent, or longContext).
    model: modelRefSchema.optional(),
    tools: z
      .array(z.string())
      .min(1)
      .refine((names) => names.every((name) => EVAL_TOOLS.includes(name)), {
        message: `tools must be among: ${EVAL_TOOLS.join(', ')}`,
      })
      .default(EVAL_TOOLS),
    promptId: z
      .enum(Object.keys(agentSystemPrompts) as [keyof typeof agentSystemPrompts])
      .default(DEFAULT_AGENT_PROMPT),
    // A smaller per-step input budget than chat's; comparisons between models set the same
    // one for all of them.
    maxInputTokens: z.int().min(2_000).optional(),
    // Off unless the config is about memory: seeded memories must not reach other configs.
    useMemory: z.boolean().default(false),
    // longContext: tokens of corpus text in the prompt, shared between the sources.
    maxContextTokens: z.int().min(1_000).default(120_000),
    judge: z.boolean().default(true),
    // Least time between two cases' starts. An agent case makes ~3 calls and Gemini Flash's
    // free tier allows ~5 a minute.
    gapMs: z.int().min(0).default(45_000),
    timeoutMs: z.int().positive().default(240_000),
    caseTypes: z.array(z.enum(EvalCaseType)).min(1).optional(),
    // Only cases with one of these tags; cases with an excluded tag never run. Personal cases
    // only make sense with their memories seeded.
    tags: z.array(z.string()).min(1).optional(),
    excludeTags: z.array(z.string()).default(['personal']),
  })
  .superRefine((config, ctx) => {
    if (config.mode === 'static' && !config.tools.includes('search_sources')) {
      ctx.addIssue({ code: 'custom', message: 'static mode searches with search_sources' });
    }
    if (config.mode === 'longContext' && config.useMemory) {
      ctx.addIssue({ code: 'custom', message: 'longContext answers without memory' });
    }
  });

export type AnswerConfig = z.infer<typeof answerConfigSchema>;

export function answerModel(config: AnswerConfig): ModelRef {
  if (config.model) return config.model;
  return config.mode === 'longContext' ? textRoutes.longContext.primary : textRoutes.agent.primary;
}

export function loadAnswerConfig(name: string, dir = ANSWER_CONFIG_DIR) {
  return readConfig(answerConfigSchema, name, dir);
}

export function answerConfigNames(dir = ANSWER_CONFIG_DIR) {
  return configNames(dir);
}
