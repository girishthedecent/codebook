import { paginate } from '../../utils/helpers/pagination.helpers.js';
import { logEvent } from '../../utils/helpers/log.helpers.js';
import type { FailedQueriesQuery, FailureReason, StatsQuery } from './monitoring.dto.js';
import {
  answerStats,
  findFailedAnswers,
  ingestionStats,
  providerStats,
  questionsFor,
  usagePerDay,
} from './monitoring.repository.js';

const EXCERPT_CHARS = 300;

/** part / whole, rounded to 4 places; null when there is nothing to divide. */
const rate = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 10_000) / 10_000;

const ms = (value: number | null) => (value === null ? null : Math.round(value));

export async function statsService({ from, to }: StatsQuery) {
  const started = performance.now();
  const [answers, days, providers, ingestion] = await Promise.all([
    answerStats(from, to),
    usagePerDay(from, to),
    providerStats(from, to),
    ingestionStats(from, to),
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
