import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import type { PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import {
  toWorkspaceResponse,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceParams,
} from './workspace.dto.js';
import {
  createWorkspaceService,
  deleteWorkspaceService,
  getWorkspaceService,
  listWorkspacesService,
  updateWorkspaceService,
} from './workspace.service.js';

export async function createWorkspaceHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const workspace = await createWorkspaceService(user.id, req.body as CreateWorkspaceInput);
  res.status(201).json(successResponse('Workspace created', toWorkspaceResponse(workspace)));
}

export async function listWorkspacesHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const page = await listWorkspacesService(user.id, res.locals.query as PaginationQuery);
  res.json(
    successResponse('Workspaces', {
      items: page.items.map(toWorkspaceResponse),
      nextCursor: page.nextCursor,
    }),
  );
}

export async function getWorkspaceHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const workspace = await getWorkspaceService(user.id, workspaceId);
  res.json(successResponse('Workspace', toWorkspaceResponse(workspace)));
}

export async function updateWorkspaceHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const workspace = await updateWorkspaceService(
    user.id,
    workspaceId,
    req.body as UpdateWorkspaceInput,
  );
  res.json(successResponse('Workspace updated', toWorkspaceResponse(workspace)));
}

export async function deleteWorkspaceHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  await deleteWorkspaceService(user.id, workspaceId);
  res.status(204).end();
}
