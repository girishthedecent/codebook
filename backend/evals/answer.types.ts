import type { SavedToolCall } from '../src/modules/chat/agent.js';
import type { CheckedCitation, CitationRef } from '../src/modules/citations/citations.types.js';
import type { EvalCaseType } from '../src/generated/prisma/enums.js';
import type { ExpectedRef } from './dataset.js';

// What the answer suite stores per case, and what the scorers read back. The suite writes
// EvalResult rows in these shapes; the judge, trajectory scorer, summary and report only
// ever read them, so a stored run can be rescored or re-reported without new answers.

export const ANSWER_SUITE = 'answer';

/** A passage the answerer was shown (EvalResult.retrieved.passages), numbered as cited. */
export type StoredPassage = CitationRef & {
  // The corpus source it came from (book / repo / docs), null for web results.
  sourceKey: string | null;
};

/** EvalResult.retrieved for an answer case. */
export type StoredAnswerContext = {
  passages: StoredPassage[];
  // Long-context runs only: what was stuffed into the prompt instead of passages.
  longContext?: {
    tokens: number;
    // Per source key: tokens kept of the source's total.
    kept: Record<string, { tokens: number; total: number }>;
    // Per expected ref, in order: was its page / lines / page inside the stuffed text.
    refsCovered: boolean[];
  };
};

/** EvalResult.toolTrajectory for an answer case. */
export type StoredTrajectory = {
  calls: SavedToolCall[];
  steps: number;
  forcedFinal: boolean;
  staticRag: boolean;
  model: string | null;
  fallbackUsed: boolean;
  promptId: string;
  status: 'COMPLETE' | 'ERROR' | 'ABORTED';
};

/** Everything a judge needs about one answered case. */
export type JudgeInput = {
  caseId: string;
  type: EvalCaseType;
  question: string;
  expectedAnswer: string;
  refs: ExpectedRef[];
  answer: string;
  citations: CheckedCitation[];
  passages: StoredPassage[];
  // Long-context answers have no passages: only correctness and no-answer are judged.
  grounded: boolean;
};

export type ClaimVerdict = {
  claim: string;
  supported: boolean;
  // The citation numbers attached to the claim in the answer.
  cited: number[];
  reason: string;
};

export type CitationVerdict = { n: number; supports: boolean; reason: string };

export type TrajectoryScores = {
  // From the case's `tool:<name>` tags; empty when the case expects none.
  expectedTools: string[];
  // null when the case expects no tool.
  expectedToolUsed: boolean | null;
  steps: number;
  toolCalls: number;
  // The same tool with the same arguments called again in one answer.
  redundantCalls: number;
  toolErrors: number;
  hitMaxSteps: boolean;
};

/**
 * EvalResult.scores for an answer case. A metric that wasn't measured is null, never 0:
 * a skipped judge call must not read as a wrong answer.
 */
export type AnswerScores = {
  // 0, 0.5 or 1 against the expected answer.
  correctness: number | null;
  // Supported claims / claims.
  faithfulness: number | null;
  // Citations whose passage supports their sentence / valid citations.
  citationPrecision: number | null;
  // Expected refs that a cited passage hits / expected refs.
  citationRecall: number | null;
  // NO_ANSWER cases: did the answer decline. null for answerable cases.
  noAnswerCorrect: boolean | null;
  // The answer says the sources don't cover the question.
  declined: boolean;
  claims: ClaimVerdict[];
  citationVerdicts: CitationVerdict[];
  correctnessReason: string | null;
  trajectory: TrajectoryScores;
  judge: {
    model: string;
    prompts: string[];
    // Verdicts that came from EvalJudgeCache.
    cached: number;
    // Why a judge call was skipped or failed, if one was.
    skipped: string | null;
  };
  // The run's numbers for this case don't measure what the config says: the answer model
  // fell back, or a judge call failed.
  tainted: boolean;
  // Long-context: every expected ref was inside the stuffed text. null otherwise.
  covered: boolean | null;
};

/** One case as the summary sees it. */
export type AnswerOutcome = {
  type: EvalCaseType;
  tags: string[];
  reviewed: boolean;
  scores: AnswerScores | null;
  error: boolean;
  latencyMs: number;
  costUsd: number;
};

export type AnswerMetrics = {
  cases: number;
  errors: number;
  tainted: number;
  // Means over the cases where the metric was measured (null when none were).
  correctness: number | null;
  faithfulness: number | null;
  citationPrecision: number | null;
  citationRecall: number | null;
  noAnswerAccuracy: number | null;
  expectedToolRate: number | null;
  avgSteps: number | null;
  redundantCallRate: number | null;
  toolErrorRate: number | null;
  maxStepsRate: number | null;
  costPerQueryUsd: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

/** EvalRun.summary for an answer run. */
export type AnswerSummary = {
  suite: typeof ANSWER_SUITE;
  overall: AnswerMetrics;
  byType: Partial<Record<EvalCaseType, AnswerMetrics>>;
  reviewedOnly: AnswerMetrics;
  // Long-context runs: the same metrics over the cases whose refs fit in the prompt.
  coveredOnly?: AnswerMetrics;
  judge: { model: string; prompts: string[] };
  // The answer model is the judge model.
  selfJudged: boolean;
  // The answer model comes from the judge's provider (a model family tends to favour its own).
  sameProviderJudge: boolean;
};
