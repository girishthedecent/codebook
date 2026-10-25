import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';
import prismaClient from '../src/config/db.config.js';
import type { EvalCaseType } from '../src/generated/prisma/enums.js';
import { generateObject } from '../src/llm/client.js';
import { synthQuestionPrompt } from '../src/llm/prompts/synthQuestion.js';
import { questionsFor } from '../src/modules/monitoring/monitoring.repository.js';
import { createPacer } from '../src/utils/pacer.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { datasetFileSchema, evalCaseSchema, importCases, type ExpectedRef } from './dataset.js';

// Candidate cases for the golden set (PLAN 14.5, 14.6): drafted from the corpus or taken
// from answers that went wrong, written to a file for review, and merged into the dataset
// only once a reviewer marks them accepted. The files quote the corpus and users'
// questions, so they stay out of git.

export const SYNTHETIC_FILE = 'evals/datasets/synthetic-candidates.json';
export const FAILURE_FILE = 'evals/datasets/failure-candidates.json';

const EXCERPT_CHARS = 300;
// Parents shorter than this are headings, tables of contents and license headers.
const MIN_PARENT_TOKENS = 120;
// A model call that keeps failing usually means the quota is gone for now.
const MAX_FAILURES_IN_A_ROW = 3;

/**
 * A case in review: the dataset fields (placeholders until filled in), `accepted` set by
 * the reviewer, and `from` saying where it came from. Only accepted ones are validated.
 */
export const candidateSchema = z.looseObject({
  id: z.string().trim().min(1).max(64),
  origin: z.enum(['SYNTHETIC', 'FAILURE']),
  accepted: z.boolean().default(false),
  from: z.record(z.string(), z.unknown()).default({}),
});

export type Candidate = z.infer<typeof candidateSchema>;

export async function readCandidates(file: string): Promise<Candidate[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const parsed = z.array(candidateSchema).safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`${file} is not a candidates file:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * JSON as prettier would write it, so a dataset file stays diff-friendly. Written to a temp
 * file and renamed, so an interrupted write never leaves half a file.
 */
export async function writeJson(file: string, value: unknown) {
  const options = (await resolveConfig(file)) ?? {};
  const text = await format(JSON.stringify(value, null, 2), { ...options, parser: 'json' });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text);
  await rename(temp, file);
}

// --- synthetic ---------------------------------------------------------------------------

export type SourceKey = 'book' | 'repo' | 'docs';

const CASE_TYPE: Record<SourceKey, EvalCaseType> = { book: 'BOOK', repo: 'CODE', docs: 'BOOK' };

type ParentRow = {
  id: string;
  content: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  document: { path: string };
};

/** The ref a question about this parent should be found by: exactly what the parent covers. */
export function refOf(sourceKey: SourceKey, parent: Omit<ParentRow, 'id' | 'content'>) {
  if (sourceKey === 'book') {
    if (parent.pageStart === null) return null;
    return {
      sourceKey,
      pageStart: parent.pageStart,
      pageEnd: parent.pageEnd ?? parent.pageStart,
    } satisfies ExpectedRef;
  }
  if (sourceKey === 'repo') {
    if (parent.lineStart === null) return null;
    return {
      sourceKey,
      path: parent.document.path,
      lineStart: parent.lineStart,
      lineEnd: parent.lineEnd ?? parent.lineStart,
    } satisfies ExpectedRef;
  }
  const heading = parent.headingPath.at(-1);
  return {
    sourceKey,
    url: parent.document.path,
    ...(heading ? { heading } : {}),
  } satisfies ExpectedRef;
}

function where(parent: ParentRow) {
  if (parent.pageStart !== null) {
    const end = parent.pageEnd ?? parent.pageStart;
    return end === parent.pageStart
      ? `page ${parent.pageStart}`
      : `pages ${parent.pageStart}-${end}`;
  }
  if (parent.lineStart !== null) {
    return `${parent.document.path}, lines ${parent.lineStart}-${parent.lineEnd}`;
  }
  return parent.document.path;
}

const synthSchema = z.object({
  question: z.string().min(10).max(400),
  answer: z.string().min(10).max(800),
  usable: z.boolean(),
});

const KIND: Record<SourceKey, string> = {
  book: 'book',
  repo: 'code repository',
  docs: 'documentation site',
};

function shuffle<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export const candidateId = (prefix: string, key: string) =>
  `${prefix}-${createHash('sha256').update(key).digest('hex').slice(0, 10)}`;

export type SynthOptions = {
  userId: string;
  workspaceId: string;
  sourceId: string;
  sourceKey: SourceKey;
  n: number;
  gapMs: number;
  // Parent chunks already drafted from, so a second run asks about new passages.
  skipChunkIds?: Set<string>;
  random?: () => number;
  log?: (line: string) => void;
  // Called after each new candidate, so an interrupted run keeps what it made.
  onCandidate?: (candidate: Candidate) => Promise<void>;
};

/** Drafts up to `n` candidates from random parent chunks of one corpus source. */
export async function synthesizeCandidates(options: SynthOptions) {
  const { log = () => {}, random = Math.random } = options;
  const ids = await prismaClient.sourceChunk.findMany({
    where: {
      sourceId: options.sourceId,
      workspaceId: options.workspaceId,
      kind: 'PARENT',
      tokenCount: { gte: MIN_PARENT_TOKENS },
    },
    select: { id: true },
  });
  const pool = shuffle(
    ids.map((row) => row.id).filter((id) => !options.skipChunkIds?.has(id)),
    random,
  );
  log(`${pool.length} passages to draw from`);

  const pace = createPacer(options.gapMs);
  const made: Candidate[] = [];
  let failures = 0;
  for (const chunkId of pool) {
    if (made.length >= options.n) break;
    const parent = await prismaClient.sourceChunk.findUniqueOrThrow({
      where: { id: chunkId },
      select: {
        id: true,
        content: true,
        headingPath: true,
        pageStart: true,
        pageEnd: true,
        lineStart: true,
        lineEnd: true,
        document: { select: { path: true } },
      },
    });
    const ref = refOf(options.sourceKey, parent);
    if (!ref) continue;

    await pace();
    let draft: z.infer<typeof synthSchema>;
    try {
      const { object } = await generateObject({
        task: 'cheap',
        prompt: synthQuestionPrompt.render({
          kind: KIND[options.sourceKey],
          location: where(parent),
          passage: parent.content,
        }),
        schema: synthSchema,
        schemaName: 'eval_case',
        ctx: { userId: options.userId, workspaceId: options.workspaceId },
      });
      draft = object;
      failures = 0;
    } catch (error) {
      failures += 1;
      log(`  ${where(parent)}: ${error instanceof Error ? error.message : String(error)}`);
      if (failures >= MAX_FAILURES_IN_A_ROW) {
        log(`Stopping after ${failures} failed calls in a row`);
        break;
      }
      continue;
    }
    if (!draft.usable) {
      log(`  ${where(parent)}: nothing worth asking`);
      continue;
    }

    const candidate: Candidate = {
      id: candidateId(`synth-${options.sourceKey}`, parent.id),
      origin: 'SYNTHETIC',
      accepted: false,
      type: CASE_TYPE[options.sourceKey],
      split: 'DEV',
      question: draft.question.trim(),
      expectedAnswer: draft.answer.trim(),
      expectedRefs: [ref],
      tags: ['synthetic'],
      reviewed: false,
      from: { chunkId: parent.id, location: where(parent), prompt: synthQuestionPrompt.id },
    };
    made.push(candidate);
    await options.onCandidate?.(candidate);
    log(`  ${made.length}/${options.n} ${where(parent)}: ${candidate.question as string}`);
  }
  return made;
}

// --- failures ----------------------------------------------------------------------------

export type FailureScope =
  { workspaceId: string; userId?: never } | { userId: string; workspaceId?: never };

export type FailureReason = 'thumbs_down' | 'invalid_citations' | 'weak_retrieval';

/**
 * Answers in one workspace (or of one user) that went wrong — a thumbs down, citations that
 * pointed nowhere, or a search that found nothing good — as candidates to turn into cases.
 * Only the question and a short excerpt of the answer are kept, never what it was shown.
 */
export async function failureCandidates(scope: FailureScope, limit = 200): Promise<Candidate[]> {
  const answers = await prismaClient.message.findMany({
    where: {
      role: 'ASSISTANT',
      conversation: scope.workspaceId
        ? { workspaceId: scope.workspaceId }
        : { userId: scope.userId },
      OR: [{ feedback: 'DOWN' }, { invalidCitations: { gt: 0 } }, { weakRetrieval: true }],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      conversationId: true,
      content: true,
      feedback: true,
      feedbackNote: true,
      invalidCitations: true,
      weakRetrieval: true,
      createdAt: true,
      conversation: { select: { workspaceId: true } },
    },
  });
  const questions = await questionsFor(answers.map((answer) => answer.id));

  return answers.flatMap((answer) => {
    const question = questions.get(answer.id);
    if (!question) return [];
    const reasons: FailureReason[] = [];
    if (answer.feedback === 'DOWN') reasons.push('thumbs_down');
    if (answer.invalidCitations > 0) reasons.push('invalid_citations');
    if (answer.weakRetrieval) reasons.push('weak_retrieval');
    return [
      {
        id: candidateId('failure', answer.id),
        origin: 'FAILURE' as const,
        accepted: false,
        // To fill in during review: the type, the right answer and where it is.
        type: null,
        split: 'DEV',
        question,
        expectedAnswer: '',
        expectedRefs: [],
        tags: ['failure'],
        reviewed: false,
        from: {
          messageId: answer.id,
          conversationId: answer.conversationId,
          workspaceId: answer.conversation.workspaceId,
          createdAt: answer.createdAt.toISOString(),
          reasons,
          answerExcerpt: answer.content.slice(0, EXCERPT_CHARS),
          feedbackNote: answer.feedbackNote,
        },
      },
    ];
  });
}

/** Adds the candidates whose id isn't in the file yet; the reviewer's edits are kept. */
export function addNew(existing: Candidate[], fresh: Candidate[]) {
  const ids = new Set(existing.map((candidate) => candidate.id));
  const added = fresh.filter((candidate) => !ids.has(candidate.id));
  return { candidates: [...existing, ...added], added: added.length };
}

// --- import ------------------------------------------------------------------------------

type RawCase = { id?: unknown; origin?: unknown };

/**
 * Merges the accepted candidates into a dataset file's cases (as read, so the cases already
 * there keep their exact form) by id. A case from the same origin is replaced (a re-import
 * after edits); any other id clash, including two accepted candidates with one id, is an
 * error. Accepting is the review, so they come in reviewed, and never with the `gate` tag:
 * the CI gate only runs hand-picked cases. Throws unless the whole merged file is valid, so
 * nothing half-merged is ever written.
 */
export function mergeAccepted(dataset: RawCase[], candidates: Candidate[]) {
  const accepted = candidates.filter((candidate) => candidate.accepted);
  const problems: string[] = [];
  const merged: RawCase[] = [...dataset];
  const seen = new Set<string>();

  for (const candidate of accepted) {
    if (seen.has(candidate.id)) {
      problems.push(`${candidate.id}: accepted twice in the candidates file`);
      continue;
    }
    seen.add(candidate.id);
    const { accepted: _, from: __, ...fields } = candidate;
    const tags = Array.isArray(fields.tags) ? fields.tags.filter((tag) => tag !== 'gate') : [];
    const parsed = evalCaseSchema.safeParse({ ...fields, tags, reviewed: true });
    if (!parsed.success) {
      problems.push(`${candidate.id}: ${z.prettifyError(parsed.error)}`);
      continue;
    }
    const { memories, ...rest } = parsed.data;
    const item: RawCase = memories.length > 0 ? parsed.data : rest;
    const index = merged.findIndex((row) => row.id === candidate.id);
    const origin = index === -1 ? null : (merged[index]!.origin ?? 'MANUAL');
    if (index === -1) {
      merged.push(item);
    } else if (origin === candidate.origin) {
      merged[index] = item;
    } else {
      problems.push(
        `${candidate.id}: the dataset already has a ${String(origin)} case with this id`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`Some accepted candidates can't be imported:\n${problems.join('\n')}`);
  }
  const file = datasetFileSchema.safeParse(merged);
  if (!file.success) {
    throw new Error(`The merged dataset would not be valid:\n${z.prettifyError(file.error)}`);
  }
  return { cases: merged, parsed: file.data, accepted: accepted.length };
}

/**
 * Merges a candidates file's accepted cases into a dataset file and imports the result. The
 * dataset file is only rewritten after the import went through, so a refused merge or a
 * failed import leaves it as it was.
 */
export async function importAccepted(
  datasetFile: string,
  candidatesFile: string,
  name: string,
  corpus?: Prisma.InputJsonValue,
) {
  const raw = JSON.parse(await readFile(datasetFile, 'utf8')) as RawCase[];
  const { cases, parsed, accepted } = mergeAccepted(raw, await readCandidates(candidatesFile));
  if (accepted === 0) return { accepted, imported: 0, missing: [] as string[] };
  const result = await importCases(name, parsed, corpus);
  await writeJson(datasetFile, cases);
  return { accepted, imported: result.imported, missing: result.missing };
}
