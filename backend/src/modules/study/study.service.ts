import { appConfig } from '../../config/app.config.js';
import { inngest } from '../../config/inngest.config.js';
import type { Prisma, StudyArtifact } from '../../generated/prisma/client.js';
import { studyGenerateRequested } from '../../inngest/events.js';
import { ConflictError, NotFoundError } from '../../utils/errors/app.error.js';
import { assertTokenBudget } from '../../utils/quotas.js';
import type { CitationRef } from '../citations/citations.types.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';
import type { CreateStudyInput, ListStudyQuery, StudyInput } from './study.dto.js';
import { citedNumbers, defaultCount, LABELS, promptFor } from './study.generate.js';
import {
  createArtifact,
  deleteArtifact,
  findArtifact,
  findArtifactForUser,
  findTocPath,
  findWorkspaceSources,
  listArtifacts,
  requeueArtifact,
  updateActiveArtifact,
  updateArtifactIfExists,
} from './study.repository.js';
import type { StudyData } from './study.schemas.js';

// Shown on a set the owner stopped; the generation function leaves such a set alone.
export const CANCELLED_MESSAGE = 'Cancelled.';

// Stored citations keep this much of each passage: enough for the snippet and a preview.
const STORED_TEXT_CHARS = 1_500;

// ---- reading ----------------------------------------------------------------------------

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

// ---- generating -------------------------------------------------------------------------

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
  // Conditional, so a run that finishes at the same moment isn't turned into a failure.
  const cancelled = await updateActiveArtifact(artifactId, {
    status: 'FAILED',
    error: CANCELLED_MESSAGE,
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
      error: "Couldn't start generating. Try again in a moment.",
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

// ---- called by the Inngest function -----------------------------------------------------

/** Marks the run as started; null when the artifact was deleted or cancelled meanwhile. */
export async function startStudy(artifactId: string) {
  const artifact = await updateActiveArtifact(artifactId, { status: 'RUNNING', error: null });
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
    title: data.title.slice(0, 200) || undefined,
    data: data as unknown as Prisma.InputJsonValue,
    sources: sources as unknown as Prisma.InputJsonValue,
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
export async function failStudy(artifactId: string, error: string) {
  await updateActiveArtifact(artifactId, { status: 'FAILED', error });
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
