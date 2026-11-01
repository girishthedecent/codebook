import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type { WorkspaceParams } from '../workspaces/workspace.dto.js';
import {
  toAttemptResponse,
  toStudyResponse,
  type CreateAttemptInput,
  type CreateStudyInput,
  type ListAttemptsQuery,
  type ListStudyQuery,
  type StudyParams,
} from './study.dto.js';
import {
  attemptSummariesService,
  cancelStudyService,
  createAttemptService,
  createStudyService,
  deleteStudyService,
  getStudyService,
  listAttemptsService,
  listStudyService,
  regenerateStudyService,
} from './study.service.js';

export async function createStudyHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const artifact = await createStudyService(user.id, workspaceId, req.body as CreateStudyInput);
  res.status(202).json(successResponse('Study set queued', toStudyResponse(artifact)));
}

export async function listStudyHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const page = await listStudyService(user.id, workspaceId, res.locals.query as ListStudyQuery);
  const attempts = await attemptSummariesService(
    user.id,
    page.items.map((artifact) => artifact.id),
  );
  res.json(
    successResponse('Study sets', {
      items: page.items.map((artifact) =>
        toStudyResponse(artifact, { attempts: attempts.get(artifact.id) }),
      ),
      nextCursor: page.nextCursor,
    }),
  );
}

export async function getStudyHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { studyId } = res.locals.params as StudyParams;
  const artifact = await getStudyService(user.id, studyId);
  const attempts = await attemptSummariesService(user.id, [artifact.id]);
  res.json(
    successResponse(
      'Study set',
      toStudyResponse(artifact, { full: true, attempts: attempts.get(artifact.id) }),
    ),
  );
}

export async function deleteStudyHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { studyId } = res.locals.params as StudyParams;
  await deleteStudyService(user.id, studyId);
  res.status(204).end();
}

export async function regenerateStudyHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { studyId } = res.locals.params as StudyParams;
  const artifact = await regenerateStudyService(user.id, studyId);
  const attempts = await attemptSummariesService(user.id, [artifact.id]);
  res
    .status(202)
    .json(
      successResponse(
        'Study set queued',
        toStudyResponse(artifact, { attempts: attempts.get(artifact.id) }),
      ),
    );
}

export async function cancelStudyHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { studyId } = res.locals.params as StudyParams;
  const artifact = await cancelStudyService(user.id, studyId);
  const attempts = await attemptSummariesService(user.id, [artifact.id]);
  res.json(
    successResponse(
      'Study set cancelled',
      toStudyResponse(artifact, { attempts: attempts.get(artifact.id) }),
    ),
  );
}

export async function createAttemptHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { studyId } = res.locals.params as StudyParams;
  const attempt = await createAttemptService(user.id, studyId, req.body as CreateAttemptInput);
  res.status(201).json(successResponse('Attempt saved', toAttemptResponse(attempt)));
}

export async function listAttemptsHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { studyId } = res.locals.params as StudyParams;
  const attempts = await listAttemptsService(
    user.id,
    studyId,
    res.locals.query as ListAttemptsQuery,
  );
  res.json(successResponse('Attempts', { items: attempts.map(toAttemptResponse) }));
}
