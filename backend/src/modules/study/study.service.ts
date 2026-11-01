import { appConfig } from '../../config/app.config.js';
import { inngest } from '../../config/inngest.config.js';
import type { Prisma, StudyArtifact, StudyType } from '../../generated/prisma/client.js';
import { studyGenerateRequested } from '../../inngest/events.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors/app.error.js';
import { assertTokenBudget } from '../../utils/quotas.js';
import type { CitationRef } from '../citations/citations.types.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';
import type {
  AttemptSummary,
  CreateAttemptInput,
  CreateStudyInput,
  ListAttemptsQuery,
  ListStudyQuery,
  StudyInput,
} from './study.dto.js';
import { citedNumbers, defaultCount, LABELS, promptFor } from './study.generate.js';
import {
  attemptSummaries,
  createArtifact,
  createAttempt,
  deleteArtifact,
  findArtifact,
  findArtifactForUser,
  findTocPath,
  findWorkspaceSources,
  listArtifacts,
  listAttempts,
  requeueArtifact,
  updateActiveArtifact,
  updateArtifactIfExists,
} from './study.repository.js';
import { STUDY_ERROR_MESSAGES, type StudyErrorCode } from './study.errors.js';
import type { StudyData } from './study.schemas.js';

// Stored citations keep this much of each passage: enough for the snippet and a preview.
const STORED_TEXT_CHARS = 1_500;

export async function listStudyService(userId: string, workspaceId: string, query: ListStudyQuery) {
  await assertWorkspaceAccess(userId, workspaceId, { allowDemoRead: true });
  const { type, ...page } = query;
  return listArtifacts(workspaceId, type, page);
}

/** The artifact if this user may read it (demo artifacts included); otherwise a 404. */
export async function getStudyService(userId: string, artifactId: string) {
  const artifact = await findArtifactForUser(userId, artifactId, { includeDemo: true });
  if (!artifact) throw new NotFoundError('Study set not found');
  return artifact;
}

// Sets with items to get right or wrong; summaries and concept maps are only read.
const ATTEMPTED_TYPES: ReadonlySet<StudyType> = new Set(['QUIZ', 'FLASHCARDS']);

/**
 * A pass through a quiz or a deck. Anyone who may read the set may save one (guests on the
 * demo too): attempts are the user's own, like conversations.
 */
export async function createAttemptService(
  userId: string,
  artifactId: string,
  input: CreateAttemptInput,
) {
  const artifact = await getStudyService(userId, artifactId);
  if (!ATTEMPTED_TYPES.has(artifact.type)) {
    throw new BadRequestError('Only quizzes and flashcards take attempts');
  }
  if (artifact.status !== 'DONE') throw new ConflictError('This study set is not ready yet');
  return createAttempt({ artifactId, userId, ...input }, appConfig.study.attemptsKept);
}

export async function listAttemptsService(
  userId: string,
  artifactId: string,
  { limit }: ListAttemptsQuery,
) {
  await getStudyService(userId, artifactId);
  return listAttempts(artifactId, userId, limit);
}

/** The user's record with each of these sets, by set id; sets they never tried are left out. */
export async function attemptSummariesService(userId: string, artifactIds: string[]) {
  const rows = await attemptSummaries(userId, artifactIds);
  return new Map<string, AttemptSummary>(
    rows.map(({ artifactId, score, total, createdAt, count }) => [
      artifactId,
      { lastAttempt: { score, total, createdAt }, attemptCount: count },
    ]),
  );
}

export async function createStudyService(
  userId: string,
  workspaceId: string,
  { type, ...request }: CreateStudyInput,
) {
  // Owner only: the demo workspace is read-only for everyone else.
  await assertWorkspaceAccess(userId, workspaceId);
  await assertTokenBudget(userId);

  const sources = await findWorkspaceSources(workspaceId, request.sourceIds);
  if (sources.length !== request.sourceIds.length) throw new NotFoundError('Source not found');
  if (request.tocNodeId && !(await findTocPath(request.sourceIds, request.tocNodeId))) {
    throw new NotFoundError('Section not found');
  }

  const input: StudyInput = { ...request, count: request.count ?? defaultCount(type) };
  const scope = request.topic ?? request.pathPrefix ?? sources.map((s) => s.title).join(', ');
  const artifact = await createArtifact({
    workspaceId,
    userId,
    type,
    title: `${capitalize(LABELS[type])}: ${scope}`.slice(0, 200),
    input,
  });
  return queueGeneration(artifact);
}

export async function regenerateStudyService(userId: string, artifactId: string) {
  const artifact = await findArtifactForUser(userId, artifactId);
  if (!artifact) throw new NotFoundError('Study set not found');
  await assertTokenBudget(userId);
  // Conditional, so two regenerates at once queue one run between them.
  const staleBefore = new Date(Date.now() - appConfig.study.staleAfterMs);
  const queued = await requeueArtifact(artifactId, staleBefore);
  if (!queued) throw new ConflictError('This study set is already being generated');
  return queueGeneration(queued);
}

export async function cancelStudyService(userId: string, artifactId: string) {
  const artifact = await findArtifactForUser(userId, artifactId);
  if (!artifact) throw new NotFoundError('Study set not found');
  // Conditional, so a run that finishes at the same moment isn't turned into a failure. The
  // generation function leaves a cancelled set alone.
  const cancelled = await updateActiveArtifact(artifactId, {
    status: 'FAILED',
    error: STUDY_ERROR_MESSAGES.CANCELLED,
    errorCode: 'CANCELLED',
  });
  if (!cancelled) throw new ConflictError('This study set is not being generated');
  return cancelled;
}

async function queueGeneration(artifact: StudyArtifact) {
  try {
    await inngest.send(studyGenerateRequested.create({ artifactId: artifact.id }));
  } catch (error) {
    await updateArtifactIfExists(artifact.id, {
      status: 'FAILED',
      error: STUDY_ERROR_MESSAGES.QUEUE_FAILED,
      errorCode: 'QUEUE_FAILED',
    });
    throw error;
  }
  return artifact;
}

export async function deleteStudyService(userId: string, artifactId: string) {
  const artifact = await findArtifactForUser(userId, artifactId);
  if (!artifact) throw new NotFoundError('Study set not found');
  await deleteArtifact(artifactId);
}

/** Marks the run as started; null when the artifact was deleted or cancelled meanwhile. */
export async function startStudy(artifactId: string) {
  const artifact = await updateActiveArtifact(artifactId, {
    status: 'RUNNING',
    error: null,
    errorCode: null,
  });
  if (!artifact) return null;
  return {
    type: artifact.type,
    input: artifact.input as StudyInput,
    userId: artifact.userId,
    workspaceId: artifact.workspaceId,
  };
}

export async function saveStudy(
  artifactId: string,
  artifact: { type: StudyArtifact['type'] },
  data: StudyData,
  refs: CitationRef[],
  model: string | undefined,
) {
  // Only what the items cite is kept, numbers unchanged, so the GET can resolve them.
  const cited = citedNumbers(data);
  const sources = refs
    .filter((ref) => cited.has(ref.n))
    .map((ref) => ({ ...ref, text: ref.text.slice(0, STORED_TEXT_CHARS) }));
  await updateActiveArtifact(artifactId, {
    status: 'DONE',
    error: null,
    errorCode: null,
    title: data.title.slice(0, 200) || undefined,
    data: data as Prisma.InputJsonValue,
    sources: sources as Prisma.InputJsonValue,
    model: model ?? null,
    promptVersion: promptFor[artifact.type].id,
  });
}

/** True while the run is still wanted: not deleted, not cancelled. */
export async function isStudyActive(artifactId: string) {
  const artifact = await findArtifact(artifactId);
  return artifact?.status === 'PENDING' || artifact?.status === 'RUNNING';
}

/** `error` is shown to the user, so it never carries provider details. */
export async function failStudy(artifactId: string, code: StudyErrorCode, error?: string) {
  await updateActiveArtifact(artifactId, {
    status: 'FAILED',
    error: error ?? STUDY_ERROR_MESSAGES[code],
    errorCode: code,
  });
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
