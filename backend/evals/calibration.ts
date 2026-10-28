import { z } from 'zod';
import prismaClient from '../src/config/db.config.js';
import { sha256 } from '../src/utils/hash.js';
import {
  ANSWER_SUITE,
  type AnswerScores,
  type StoredAnswerContext,
  type StoredPassage,
} from './answer.types.js';

// Judge calibration: a sample of the grounding judge's claim verdicts for a person
// to label, then how often the two agree. The file quotes the corpus and the answers, so it
// stays out of git (evals/calibration/).

export const LABELS_FILE = 'evals/calibration/judge-labels.json';

const labelSchema = z.object({
  id: z.string(),
  runId: z.string(),
  caseId: z.string(),
  claim: z.string(),
  judgeSupported: z.boolean(),
  cited: z.array(z.object({ n: z.int(), ref: z.string(), text: z.string() })),
  // Fill in: true when the cited passages support the claim, false when they don't.
  human: z.boolean().nullable(),
  note: z.string().default(''),
});

export const fileSchema = z.object({
  judge: z.string(),
  prompt: z.string(),
  createdAt: z.string(),
  items: z.array(labelSchema),
});

export type Label = z.infer<typeof labelSchema>;

function refOf(passage: StoredPassage) {
  if (passage.pageStart !== undefined) {
    const pages =
      passage.pageEnd !== undefined && passage.pageEnd !== passage.pageStart
        ? `pp. ${passage.pageStart}–${passage.pageEnd}`
        : `p. ${passage.pageStart}`;
    return `${passage.sourceTitle} ${pages}`;
  }
  if (passage.lineStart !== undefined) {
    return `${passage.path ?? passage.sourceTitle}:${passage.lineStart}–${passage.lineEnd}`;
  }
  return passage.url ?? passage.path ?? passage.sourceTitle;
}

/**
 * Picks `count` claim verdicts, half judged supported and half not where the runs have
 * enough of each (the judge's mistakes hide in both), in a stable order so the same runs
 * give the same sample.
 */
export function sampleLabels(candidates: Omit<Label, 'human' | 'note'>[], count: number): Label[] {
  const order = (items: typeof candidates) =>
    [...items].sort((a, b) => sha256(a.id).localeCompare(sha256(b.id)));
  const yes = order(candidates.filter((item) => item.judgeSupported));
  const no = order(candidates.filter((item) => !item.judgeSupported));
  const half = Math.ceil(count / 2);
  const takeNo = Math.min(no.length, Math.max(half, count - yes.length));
  const takeYes = Math.min(yes.length, count - takeNo);
  return [...yes.slice(0, takeYes), ...no.slice(0, takeNo)]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({ ...item, human: null, note: '' }));
}

export function agreement(items: Label[]) {
  const labelled = items.filter((item) => item.human !== null);
  const agree = labelled.filter((item) => item.human === item.judgeSupported).length;
  const count = (judge: boolean, human: boolean) =>
    labelled.filter((item) => item.judgeSupported === judge && item.human === human).length;
  return {
    labelled: labelled.length,
    agree,
    rate: labelled.length === 0 ? null : agree / labelled.length,
    // The judge said supported but the person didn't, and the other way round.
    falseSupported: count(true, false),
    falseUnsupported: count(false, true),
  };
}

export async function candidatesFrom(runIds: string[] | undefined) {
  const runs = runIds?.length
    ? await prismaClient.evalRun.findMany({ where: { id: { in: runIds }, suite: ANSWER_SUITE } })
    : await prismaClient.evalRun.findMany({
        where: { suite: ANSWER_SUITE, status: 'DONE' },
        orderBy: { startedAt: 'desc' },
        take: 5,
      });
  const results = await prismaClient.evalResult.findMany({
    where: { runId: { in: runs.map((run) => run.id) }, error: null },
    select: { runId: true, caseId: true, scores: true, retrieved: true },
  });

  return results.flatMap((result) => {
    const scores = result.scores as unknown as Partial<AnswerScores>;
    const passages = (result.retrieved as unknown as StoredAnswerContext | null)?.passages ?? [];
    const byN = new Map(passages.map((passage) => [passage.n, passage]));
    return (scores.claims ?? []).map((claim, index) => ({
      id: `${result.runId}:${result.caseId}:${index}`,
      runId: result.runId,
      caseId: result.caseId,
      claim: claim.claim,
      judgeSupported: claim.supported,
      cited: claim.cited.flatMap((n) => {
        const passage = byN.get(n);
        return passage ? [{ n, ref: refOf(passage), text: passage.text }] : [];
      }),
    }));
  });
}
