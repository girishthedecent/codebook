import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type { WorkspaceParams } from '../workspaces/workspace.dto.js';
import {
  toStudyResponse,
  type CreateStudyInput,
  type ListStudyQuery,
  type StudyParams,
} from './study.dto.js';
import {
  createStudyService,
  deleteStudyService,
  getStudyService,
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
  res.json(
    successResponse('Study sets', {
      items: page.items.map((artifact) => toStudyResponse(artifact)),
      nextCursor: page.nextCursor,
    }),
  );
}

export async function getStudyHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { studyId } = res.locals.params as StudyParams;
  const artifact = await getStudyService(user.id, studyId);
  res.json(successResponse('Study set', toStudyResponse(artifact, { full: true })));
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
  res.status(202).json(successResponse('Study set queued', toStudyResponse(artifact)));
}
