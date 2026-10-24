import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import logger from '../../config/logger.config.js';
import { generateObject } from '../../llm/client.js';
import { decomposePrompt } from '../../llm/prompts/decompose.js';
import { hydePrompt } from '../../llm/prompts/hyde.js';
import { rewritePrompt } from '../../llm/prompts/rewrite.js';
import { UpstreamError } from '../../utils/errors/app.error.js';
import { sha256 } from '../../utils/hash.js';
import type {
  ExpandedQuery,
  ExpandQueryOptions,
  HistoryTurn,
  QueryMode,
} from './retrieval.types.js';

// What a search runs for each query mode. The modes only change the texts searched for;
// the final order is always decided against the user's own question.

// Enough of the conversation to resolve "it" and "that", without paying for all of it.
const HISTORY_TURNS = 6;
const TURN_CHARS = 2_000;
const MAX_KEY_TERMS = 8;

// Limits are applied in code, not in the schemas: a model that returns one sub-query too
// many shouldn't fail the whole call.
const rewriteSchema = z.object({ question: z.string(), keyTerms: z.array(z.string()) });
const hydeSchema = z.object({ passage: z.string() });
const decomposeSchema = z.object({ queries: z.array(z.string()) });

const promptIds = {
  rewrite: rewritePrompt.id,
  hyde: hydePrompt.id,
  decompose: decomposePrompt.id,
} as const;

const memo = new Map<string, ExpandedQuery>();

export async function expandQuery(
  question: string,
  mode: QueryMode,
  options: ExpandQueryOptions = {},
): Promise<ExpandedQuery> {
  if (mode === 'none') return asAsked(question);

  const key = memoKey(question, mode, options);
  const cached = memo.get(key);
  if (cached) {
    // Refresh its place, so the cap drops what hasn't been used for longest.
    memo.delete(key);
    memo.set(key, cached);
    return cached;
  }

  let expanded: ExpandedQuery;
  try {
    expanded = await generate(question, mode, options);
  } catch (error) {
    // The client has logged the provider's error and recorded the failed call. Anything
    // else (an abort, a bug) is the caller's to handle.
    if (!(error instanceof UpstreamError)) throw error;
    logger.warn('Query mode failed; searching with the question as asked', { mode });
    return { ...asAsked(question), error: `${mode} failed; searched with the question as asked` };
  }

  memo.set(key, expanded);
  if (memo.size > appConfig.retrieval.queryModes.memoSize) {
    memo.delete(memo.keys().next().value!);
  }
  return expanded;
}

async function generate(
  question: string,
  mode: Exclude<QueryMode, 'none'>,
  { history, modelOverride, ctx, signal }: ExpandQueryOptions,
): Promise<ExpandedQuery> {
  const call = { task: 'rewrite' as const, modelOverride, ctx, abortSignal: signal };

  if (mode === 'rewrite') {
    const { object, call: info } = await generateObject({
      ...call,
      schema: rewriteSchema,
      prompt: rewritePrompt.render({ history: formatHistory(history), question }),
    });
    const rewritten = object.question.trim() || question;
    const terms = cleanList(object.keyTerms).slice(0, MAX_KEY_TERMS);
    return {
      vectorQueries: [{ text: rewritten, kind: 'query' }],
      keywordQueries: [[rewritten, ...terms].join(' ')],
      rerankQuery: question,
      generated: [rewritten, ...terms],
      fallbackUsed: info.fallbackUsed,
    };
  }

  if (mode === 'hyde') {
    const { object, call: info } = await generateObject({
      ...call,
      schema: hydeSchema,
      prompt: hydePrompt.render({ question }),
    });
    const passage = object.passage.trim();
    return {
      vectorQueries: [
        ...(passage ? [{ text: passage, kind: 'document' as const }] : []),
        { text: question, kind: 'query' },
      ],
      keywordQueries: [question],
      rerankQuery: question,
      generated: passage ? [passage] : [],
      fallbackUsed: info.fallbackUsed,
    };
  }

  const { maxSubQueries } = appConfig.retrieval.queryModes;
  const { object, call: info } = await generateObject({
    ...call,
    schema: decomposeSchema,
    prompt: decomposePrompt.render({ question, maxQueries: String(maxSubQueries) }),
  });
  const subQueries = cleanList(object.queries)
    .filter((query) => query !== question)
    .slice(0, maxSubQueries);
  const queries = [...subQueries, question];
  return {
    vectorQueries: queries.map((text) => ({ text, kind: 'query' })),
    keywordQueries: queries,
    rerankQuery: question,
    generated: subQueries,
    fallbackUsed: info.fallbackUsed,
  };
}

function asAsked(question: string): ExpandedQuery {
  return {
    vectorQueries: [{ text: question, kind: 'query' }],
    keywordQueries: [question],
    rerankQuery: question,
    generated: [],
    fallbackUsed: false,
  };
}

function formatHistory(history: HistoryTurn[] = []) {
  const turns = history.slice(-HISTORY_TURNS);
  if (turns.length === 0) return '(no earlier messages)';
  return turns.map((turn) => `${turn.role}: ${turn.content.slice(0, TURN_CHARS)}`).join('\n\n');
}

function cleanList(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function memoKey(question: string, mode: Exclude<QueryMode, 'none'>, options: ExpandQueryOptions) {
  // Only rewrite reads the history, so the other modes share one entry per question.
  const history = mode === 'rewrite' ? formatHistory(options.history) : '';
  const model = options.modelOverride
    ? `${options.modelOverride.provider}/${options.modelOverride.model}`
    : '';
  // Per user: a shared entry would let the timing tell someone what another user asked.
  return sha256(options.ctx?.userId ?? '', mode, promptIds[mode], question, history, model);
}

/** Empties the memo. For tests. */
export function clearQueryModeMemo() {
  memo.clear();
}
