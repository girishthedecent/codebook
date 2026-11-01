import { appConfig } from '../../config/app.config.js';
import { breakerStates } from '../../llm/circuitBreaker.js';
import {
  embeddingRoute,
  keyCounts,
  modelLabel,
  modelsFor,
  TASKS,
  withEveryKey,
  type TextTask,
} from '../../llm/models.js';
import { paginate } from '../../utils/helpers/pagination.helpers.js';
import { logEvent } from '../../utils/helpers/log.helpers.js';
import type {
  FailedQueriesQuery,
  FailureReason,
  IngestionFailuresQuery,
  RangeQuery,
  StatsQuery,
} from './monitoring.dto.js';
import {
  answerStats,
  findFailedAnswers,
  findIngestionFailures,
  ingestionStats,
  providerStats,
  questionsFor,
  rateLimitUse,
  usageByModel,
  usageByTask,
  usagePerDay,
} from './monitoring.repository.js';

const EXCERPT_CHARS = 300;

/** part / whole, rounded to 4 places; null when there is nothing to divide. */
const rate = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 10_000) / 10_000;

const ms = (value: number | null) => (value === null ? null : Math.round(value));

export async function statsService({ from, to, includeSystem }: StatsQuery) {
  const started = performance.now();
  const [answers, days, providers, ingestion] = await Promise.all([
    answerStats(from, to, includeSystem),
    usagePerDay(from, to, includeSystem),
    providerStats(from, to, includeSystem),
    ingestionStats(from, to, includeSystem),
  ]);

  const calls = providers.reduce((sum, row) => sum + row.calls, 0);
  const failed = providers.reduce((sum, row) => sum + row.failed, 0);
  const modelCalls = providers.reduce((sum, row) => sum + row.modelCalls, 0);
  const fallbacks = providers.reduce((sum, row) => sum + row.fallbacks, 0);
  const finished = ingestion.ready + ingestion.failed;

  logEvent('monitoring', 'stats', { durationMs: Math.round(performance.now() - started) });
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    answers: {
      count: answers.answers,
      latencyMs: { p50: ms(answers.latencyP50), p95: ms(answers.latencyP95) },
      firstTokenMs: { p50: ms(answers.firstTokenP50), p95: ms(answers.firstTokenP95) },
      retrievalMs: { p50: ms(answers.retrievalP50), p95: ms(answers.retrievalP95) },
      errorRate: rate(answers.errored, answers.answers),
      // Of the answers that got a thumbs up or down.
      thumbsDownRate: rate(answers.thumbsDown, answers.rated),
      invalidCitationRate: rate(answers.invalidCitations, answers.answers),
      weakRetrievalRate: rate(answers.weakRetrieval, answers.answers),
    },
    usagePerDay: days,
    providers: {
      fallbackRate: rate(fallbacks, modelCalls),
      errorRate: rate(failed, calls),
      byProvider: providers.map((row) => ({
        provider: row.provider,
        calls: row.calls,
        errorRate: rate(row.failed, row.calls),
        fallbackRate: rate(row.fallbacks, row.modelCalls),
      })),
    },
    ingestion: {
      ready: ingestion.ready,
      failed: ingestion.failed,
      inProgress: ingestion.inProgress,
      successRate: rate(ingestion.ready, finished),
      // Creation to last successful ingest: includes queue time (see ingestionStats).
      avgSeconds: ingestion.avgSeconds === null ? null : Math.round(ingestion.avgSeconds),
    },
  };
}

type FailedAnswer = Awaited<ReturnType<typeof findFailedAnswers>>[number];

function reasonsFor(answer: FailedAnswer) {
  const reasons: FailureReason[] = [];
  if (answer.feedback === 'DOWN') reasons.push('thumbs_down');
  if (answer.status === 'ERROR') reasons.push('error');
  if (answer.invalidCitations > 0) reasons.push('invalid_citations');
  if (answer.weakRetrieval) reasons.push('weak_retrieval');
  return reasons;
}

/** Answers worth a look, newest first: the question, an excerpt of the answer and why. */
export async function failedQueriesService(query: FailedQueriesQuery) {
  const page = await paginate(findFailedAnswers, query);
  const questions = await questionsFor(page.items.map((answer) => answer.id));
  return {
    items: page.items.map((answer) => ({
      messageId: answer.id,
      conversationId: answer.conversationId,
      workspaceId: answer.conversation.workspaceId,
      userId: answer.conversation.userId,
      createdAt: answer.createdAt,
      question: questions.get(answer.id) ?? null,
      answerExcerpt: answer.content.slice(0, EXCERPT_CHARS),
      reasons: reasonsFor(answer),
      error: answer.error,
      feedbackNote: answer.feedbackNote,
      invalidCitations: answer.invalidCitations,
    })),
    nextCursor: page.nextCursor,
  };
}

/** Model calls in the range by model and key, and by task. */
export async function modelUsageService({ from, to, includeSystem }: StatsQuery) {
  const [models, tasks] = await Promise.all([
    usageByModel(from, to, includeSystem),
    usageByTask(from, to, includeSystem),
  ]);
  return { from: from.toISOString(), to: to.toISOString(), models, tasks };
}

/** The sources whose last ingest failed, latest first, with what the user would have seen. */
export async function ingestionFailuresService({ limit, includeSystem }: IngestionFailuresQuery) {
  const sources = await findIngestionFailures(limit, includeSystem);
  return sources.map((source) => ({
    sourceId: source.id,
    workspaceId: source.workspaceId,
    userId: source.workspace.userId,
    title: source.title,
    type: source.type,
    // Where in the pipeline it stopped.
    stage: source.stage,
    error: source.error,
    failedAt: source.updatedAt,
  }));
}

/** Every limit with what it counted and turned away in the range. */
export async function rateLimitsService({ from, to }: RangeQuery) {
  const counted = new Map((await rateLimitUse(from, to)).map((row) => [row.name, row]));
  const limits = Object.entries(appConfig.limits.windows).map(([name, window]) => ({
    name,
    points: window.points,
    // Null for a calendar month.
    windowSec: 'windowSec' in window ? window.windowSec : null,
    requests: counted.get(name)?.requests ?? 0,
    blocked: counted.get(name)?.blocked ?? 0,
    clientsBlocked: counted.get(name)?.clientsBlocked ?? 0,
  }));
  return { from: from.toISOString(), to: to.toISOString(), limits };
}

// Every model a task can be sent to and the embedding model, each on every key.
function configuredModels() {
  const tasks = TASKS.filter((task): task is TextTask => task !== 'embed');
  const refs = [
    ...tasks.flatMap((task) => modelsFor(task)),
    ...withEveryKey([embeddingRoute.model], keyCounts()),
  ];
  return new Set(refs.map(modelLabel));
}

/**
 * Which models are being skipped after a quota error. The state lives in this server
 * process (it is not shared between instances and starts empty on a restart).
 */
export function circuitBreakerService(now = Date.now()) {
  const seen = new Map(breakerStates(now).map((state) => [state.model, state]));
  const models = [...new Set([...configuredModels(), ...seen.keys()])].sort().map((model) => ({
    model,
    open: seen.get(model)?.open ?? false,
    openUntil: seen.get(model)?.openUntil ?? null,
  }));
  return { coolOffMs: appConfig.circuitBreaker.coolOffMs, models };
}
