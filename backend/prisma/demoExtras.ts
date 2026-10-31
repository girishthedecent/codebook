import { setTimeout as sleep } from 'node:timers/promises';
import prismaClient from '../src/config/db.config.js';
import type { Workspace } from '../src/generated/prisma/client.js';
import type { JobStatus, StudyType } from '../src/generated/prisma/enums.js';
import { DEFAULT_TITLE } from '../src/modules/chat/conversation.service.js';
import { prepareTurnService, runTurnService } from '../src/modules/chat/turn.service.js';
import { cacheKeyFor, findCachedAnswer } from '../src/modules/demo/answerCache.js';
import { ensureDemoVisitor } from '../src/modules/demo/demo.service.js';
import { createStudyService, regenerateStudyService } from '../src/modules/study/study.service.js';
import { fail } from '../evals/corpusIngest.js';
import type { SourceKey } from '../evals/corpusWorkspace.js';

// What the demo seed adds once its sources are indexed, both of which call models: one study
// set of each type, so guests have something to open, and the answers to the starter
// questions, so the first visitor to click one doesn't wait for the agent.

const POLL_MS = 5_000;
const STUDY_TIMEOUT_MS = 20 * 60 * 1000;
const ANSWER_TIMEOUT_MS = 5 * 60 * 1000;

export type DemoStudySet = {
  type: StudyType;
  // Sources it reads, by their key in demo.json.
  sources: SourceKey[];
  topic?: string;
  count?: number;
};

export const DEMO_STUDY_SETS: DemoStudySet[] = [
  { type: 'QUIZ', sources: ['book'], count: 8 },
  { type: 'FLASHCARDS', sources: ['book'], count: 12 },
  { type: 'MINDMAP', sources: ['book', 'repo'], topic: 'attention and the GPT architecture' },
  { type: 'SUMMARY', sources: ['docs'] },
];

type ExistingSet = { id: string; type: StudyType; status: JobStatus };

export type PlannedStudySet = {
  spec: DemoStudySet;
  action: 'keep' | 'retry' | 'create';
  artifactId?: string;
};

/**
 * What a run does with each study set: one that is there, done or still generating, is kept;
 * one that only has a failed set generates again; a missing one is created.
 */
export function planStudySets(specs: DemoStudySet[], existing: ExistingSet[]): PlannedStudySet[] {
  return specs.map((spec) => {
    const sets = existing.filter((set) => set.type === spec.type);
    const usable = sets.find((set) => set.status !== 'FAILED');
    if (usable) return { spec, action: 'keep', artifactId: usable.id };
    const failed = sets[0];
    return failed ? { spec, action: 'retry', artifactId: failed.id } : { spec, action: 'create' };
  });
}

export type PlannedWarmup = { question: string; action: 'keep' | 'warm' };

/** A starter question whose answer is in the cache is left alone. */
export function planWarmups(questions: string[], cached: ReadonlySet<string>): PlannedWarmup[] {
  return questions.map((question) => ({
    question,
    action: cached.has(question) ? 'keep' : 'warm',
  }));
}

/** Creates the missing study sets for the demo owner and waits for them. False if one failed. */
export async function seedStudySets(
  ownerId: string,
  workspaceId: string,
  sourceIds: Partial<Record<SourceKey, string>>,
) {
  const existing = await prismaClient.studyArtifact.findMany({
    where: { workspaceId, userId: ownerId },
    select: { id: true, type: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  const ids: string[] = [];
  for (const { spec, action, artifactId } of planStudySets(DEMO_STUDY_SETS, existing)) {
    const label = spec.type.toLowerCase();
    if (action === 'keep') {
      console.log(`study ${label}: already there`);
      ids.push(artifactId!);
    } else if (action === 'retry') {
      await regenerateStudyService(ownerId, artifactId!);
      console.log(`study ${label}: failed before, generating again`);
      ids.push(artifactId!);
    } else {
      const chosen = spec.sources.map((key) => sourceIds[key]);
      if (chosen.some((id) => id === undefined)) {
        console.log(`study ${label}: skipped, a source it reads is missing`);
        continue;
      }
      const set = await createStudyService(ownerId, workspaceId, {
        type: spec.type,
        sourceIds: chosen as string[],
        topic: spec.topic,
        count: spec.count,
        difficulty: 'medium',
      });
      console.log(`study ${label}: queued`);
      ids.push(set.id);
    }
  }
  return waitForStudySets(ids);
}

async function waitForStudySets(ids: string[]) {
  const started = Date.now();
  for (;;) {
    const rows = await prismaClient.studyArtifact.findMany({ where: { id: { in: ids } } });
    if (rows.every((row) => row.status === 'DONE' || row.status === 'FAILED')) {
      for (const row of rows) {
        console.log(
          `study ${row.type.toLowerCase()}: ${row.status}${row.error ? ` ${row.error}` : ''}`,
        );
      }
      return rows.every((row) => row.status === 'DONE');
    }
    if (Date.now() - started > STUDY_TIMEOUT_MS)
      fail('Study sets still generating after 20 minutes');
    await sleep(POLL_MS);
  }
}

/** Asks the starter questions that have no cached answer. False if one couldn't be cached. */
export async function warmStarterAnswers(workspace: Workspace, questions: string[]) {
  const cached = new Set<string>();
  for (const question of questions) {
    if (await findCachedAnswer(await cacheKeyFor(workspace.id, question))) cached.add(question);
  }
  const visitor = await ensureDemoVisitor();
  let ok = true;
  for (const { question, action } of planWarmups(questions, cached)) {
    if (action === 'keep') console.log(`answer "${question}": already cached`);
    else ok = (await warmAnswer(workspace, visitor.id, question)) && ok;
  }
  return ok;
}

/**
 * Asks one question the way a guest would (no memory, no web search, a visitor's excerpts of
 * the book), so the answer stored is the one every visitor can be given.
 */
async function warmAnswer(workspace: Workspace, visitorId: string, question: string) {
  const conversation = await prismaClient.conversation.create({
    data: { userId: visitorId, workspaceId: workspace.id, title: DEFAULT_TITLE },
  });
  try {
    const turn = await prepareTurnService(
      { id: visitorId, isGuest: true, isSystem: true },
      conversation.id,
      question,
      { useMemory: false },
    );
    const outcome = await runTurnService(turn, () => {}, AbortSignal.timeout(ANSWER_TIMEOUT_MS), {
      useMemory: false,
    });
    if (outcome.status !== 'COMPLETE') {
      console.log(`answer "${question}": ${outcome.status} ${outcome.error ?? ''}`);
      return false;
    }
    if (!(await findCachedAnswer(await cacheKeyFor(workspace.id, question)))) {
      console.log(
        `answer "${question}": answered, but not kept (every citation must check out, none ` +
          'a web page, and no long passage copied word for word); reword the question',
      );
      return false;
    }
    console.log(`answer "${question}": cached`);
    return true;
  } finally {
    await prismaClient.conversation.delete({ where: { id: conversation.id } });
  }
}
