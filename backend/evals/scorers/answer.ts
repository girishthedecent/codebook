import prismaClient from '../../src/config/db.config.js';
import type { CallContext } from '../../src/llm/client.js';
import type { EvalCase, EvalResult } from '../../src/generated/prisma/client.js';
import { judgeCorrectnessPrompt } from '../../src/llm/prompts/judgeCorrectness.js';
import { judgeGroundingPrompt } from '../../src/llm/prompts/judgeGrounding.js';
import {
  ANSWER_SUITE,
  type AnswerMetrics,
  type AnswerOutcome,
  type AnswerScores,
  type AnswerSummary,
  type JudgeInput,
  type StoredPassage,
  type StoredTrajectory,
} from '../answer.types.js';
import { hitsRef, type MatchableChunk } from '../matching.js';
import {
  declinedByPhrase,
  groundingPrompt,
  judgeCorrectness,
  judgeGrounding,
  judgeModel,
  judgeRelation,
  validCited,
} from './judge.js';
import { percentile } from './retrieval.js';
import { scoreTrajectory } from './trajectory.js';

// Scores one answered case and sums a run's cases up (PLAN 14.2, 14.3, 14.8).

export type ScoreOptions = {
  // false: trajectory and computed metrics only, no judge calls (dry runs, tests).
  judge: boolean;
  signal?: AbortSignal;
  // The case's tags (for its `tool:` tags); read from the case when not given.
  tags?: string[];
  // Who the judge calls are recorded against, so a run's cost includes them.
  ctx?: CallContext;
};

function asMatchable(passage: StoredPassage): MatchableChunk {
  return {
    sourceKey: passage.sourceKey,
    // A page of the docs site is found by its URL.
    documentPath:
      passage.sourceKey === 'docs'
        ? (passage.url ?? passage.path ?? '')
        : (passage.path ?? passage.url ?? ''),
    headingPath: passage.heading ? passage.heading.split(' > ') : [],
    pageStart: passage.pageStart ?? null,
    pageEnd: passage.pageEnd ?? null,
    lineStart: passage.lineStart ?? null,
    lineEnd: passage.lineEnd ?? null,
  };
}

/** Expected refs that a passage the answer cites hits / expected refs. No model involved. */
export function citationRecall(input: Pick<JudgeInput, 'refs' | 'citations' | 'passages'>) {
  if (input.refs.length === 0) return null;
  const cited = new Set(validCited(input));
  const chunks = input.passages.filter((p) => cited.has(p.n)).map(asMatchable);
  const found = input.refs.filter((ref) => chunks.some((chunk) => hitsRef(chunk, ref)));
  return found.length / input.refs.length;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function caseTags(caseId: string) {
  const row = await prismaClient.evalCase.findUnique({
    where: { id: caseId },
    select: { tags: true },
  });
  return row?.tags ?? [];
}

export async function scoreAnswer(
  input: JudgeInput,
  trajectory: StoredTrajectory,
  options: ScoreOptions,
): Promise<AnswerScores> {
  const tags = options.tags ?? (await caseTags(input.caseId));
  const cited = validCited(input);
  const scores: AnswerScores = {
    correctness: null,
    faithfulness: null,
    citationPrecision: null,
    citationRecall: input.grounded ? citationRecall(input) : null,
    noAnswerCorrect: null,
    declined: declinedByPhrase(input.answer),
    claims: [],
    citationVerdicts: [],
    correctnessReason: null,
    trajectory: scoreTrajectory(tags, trajectory),
    judge: {
      model: judgeModel(),
      prompts: input.grounded
        ? [judgeCorrectnessPrompt.id, judgeGroundingPrompt.id]
        : [judgeCorrectnessPrompt.id],
      cached: 0,
      skipped: null,
    },
    tainted: trajectory.fallbackUsed,
    covered: null,
  };
  const skip = (reason: string, taints = true) => {
    scores.judge.skipped = scores.judge.skipped ? `${scores.judge.skipped}; ${reason}` : reason;
    if (taints) scores.tainted = true;
  };
  const failed = (what: string, error: unknown) => {
    if (options.signal?.aborted) throw error;
    skip(`${what} failed: ${message(error)}`);
  };

  if (!input.answer.trim()) {
    skip('no answer to judge');
  } else if (!options.judge) {
    skip('judge off', false);
  } else {
    try {
      const verdict = await judgeCorrectness(input, options.signal, options.ctx);
      scores.correctness = verdict.score;
      scores.declined = verdict.declined;
      scores.correctnessReason = verdict.reason;
      if (verdict.cached) scores.judge.cached += 1;
    } catch (error) {
      failed('correctness', error);
    }

    // A refusal that cites nothing has no claims to check.
    if (input.grounded && !(scores.declined && cited.length === 0)) {
      const prompt = groundingPrompt(input);
      if (prompt.text === null) {
        skip(prompt.skip);
      } else {
        try {
          const grounding = await judgeGrounding(prompt.text, options.signal, options.ctx);
          if (grounding.cached) scores.judge.cached += 1;
          scores.claims = grounding.claims;
          if (grounding.claims.length > 0) {
            const supported = grounding.claims.filter((claim) => claim.supported).length;
            scores.faithfulness = supported / grounding.claims.length;
          }
          // One verdict per citation the answer really used; the judge may repeat or invent.
          const byN = new Map<number, (typeof grounding.citations)[number]>();
          for (const verdict of grounding.citations) {
            if (cited.includes(verdict.n) && !byN.has(verdict.n)) byN.set(verdict.n, verdict);
          }
          scores.citationVerdicts = [...byN.values()].sort((a, b) => a.n - b.n);
          if (byN.size > 0) {
            const supports = [...byN.values()].filter((verdict) => verdict.supports).length;
            scores.citationPrecision = supports / byN.size;
          }
        } catch (error) {
          failed('grounding', error);
        }
      }
    }
  }

  if (input.type === 'NO_ANSWER') scores.noAnswerCorrect = scores.declined;
  return scores;
}

/** One stored result as the summary sees it. A result with no scores yet has null. */
export function answerOutcomeOf(
  result: Pick<EvalResult, 'scores' | 'error' | 'latencyMs' | 'costUsd'>,
  evalCase: Pick<EvalCase, 'type' | 'tags' | 'reviewed'>,
): AnswerOutcome {
  const scores = result.scores as unknown as Partial<AnswerScores> | null;
  return {
    type: evalCase.type,
    tags: evalCase.tags,
    reviewed: evalCase.reviewed,
    scores: scores && scores.trajectory ? (scores as AnswerScores) : null,
    error: result.error !== null,
    latencyMs: result.latencyMs,
    costUsd: Number(result.costUsd ?? 0),
  };
}

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Mean of a metric over the scored cases that measured it. */
function measured(scored: AnswerScores[], pick: (scores: AnswerScores) => number | null) {
  return mean(scored.flatMap((scores) => pick(scores) ?? []));
}

function ratio(part: number, whole: number) {
  return whole === 0 ? null : part / whole;
}

/**
 * Means over the cases where each metric was measured: an errored case or a skipped judge
 * call is counted (errors, tainted), not scored as 0. Cost covers every case, since a failed
 * answer still spent it; latency covers the answers that finished.
 */
export function answerMetrics(outcomes: AnswerOutcome[]): AnswerMetrics {
  const ok = outcomes.filter((outcome) => !outcome.error);
  const scored = ok.flatMap((outcome) => outcome.scores ?? []);
  const trajectories = scored.map((scores) => scores.trajectory);
  const toolCalls = trajectories.reduce((sum, t) => sum + t.toolCalls, 0);
  const latencies = ok.map((outcome) => outcome.latencyMs);

  return {
    cases: outcomes.length,
    errors: outcomes.length - ok.length,
    tainted: scored.filter((scores) => scores.tainted).length,
    correctness: measured(scored, (s) => s.correctness),
    faithfulness: measured(scored, (s) => s.faithfulness),
    citationPrecision: measured(scored, (s) => s.citationPrecision),
    citationRecall: measured(scored, (s) => s.citationRecall),
    noAnswerAccuracy: measured(scored, (s) =>
      s.noAnswerCorrect === null ? null : s.noAnswerCorrect ? 1 : 0,
    ),
    expectedToolRate: measured(scored, (s) =>
      s.trajectory.expectedToolUsed === null ? null : s.trajectory.expectedToolUsed ? 1 : 0,
    ),
    avgSteps: mean(trajectories.map((t) => t.steps)),
    redundantCallRate: ratio(
      trajectories.reduce((sum, t) => sum + t.redundantCalls, 0),
      toolCalls,
    ),
    toolErrorRate: ratio(
      trajectories.reduce((sum, t) => sum + t.toolErrors, 0),
      toolCalls,
    ),
    maxStepsRate: mean(trajectories.map((t) => (t.hitMaxSteps ? 1 : 0))),
    costPerQueryUsd: mean(outcomes.map((outcome) => outcome.costUsd)),
    p50LatencyMs: latencies.length === 0 ? null : percentile(latencies, 50),
    p95LatencyMs: latencies.length === 0 ? null : percentile(latencies, 95),
  };
}

export function summarizeAnswers(
  outcomes: AnswerOutcome[],
  judge: { answerModel: string | null },
): AnswerSummary {
  const types = [...new Set(outcomes.map((outcome) => outcome.type))].sort();
  const coverage = outcomes.filter(
    (outcome) => outcome.scores?.covered !== null && outcome.scores?.covered !== undefined,
  );
  const model = judgeModel();
  const relation = judgeRelation(judge.answerModel, model);

  return {
    suite: ANSWER_SUITE,
    overall: answerMetrics(outcomes),
    byType: Object.fromEntries(
      types.map((type) => [type, answerMetrics(outcomes.filter((o) => o.type === type))]),
    ),
    reviewedOnly: answerMetrics(outcomes.filter((outcome) => outcome.reviewed)),
    ...(coverage.length > 0
      ? { coveredOnly: answerMetrics(coverage.filter((outcome) => outcome.scores!.covered)) }
      : {}),
    judge: { model, prompts: [judgeCorrectnessPrompt.id, judgeGroundingPrompt.id] },
    selfJudged: relation.selfJudged,
    sameProviderJudge: relation.sameProvider,
  };
}
