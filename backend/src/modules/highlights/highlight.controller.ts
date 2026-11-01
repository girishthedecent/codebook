import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type { WorkspaceParams } from '../workspaces/workspace.dto.js';
import {
  toHighlightResponse,
  type CreateHighlightInput,
  type HighlightParams,
  type ListHighlightsQuery,
  type UpdateHighlightInput,
} from './highlight.dto.js';
import {
  createHighlightService,
  deleteHighlightService,
  listHighlightsService,
  updateHighlightService,
} from './highlight.service.js';

export async function listHighlightsHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const page = await listHighlightsService(
    user.id,
    workspaceId,
    res.locals.query as ListHighlightsQuery,
  );
  res.json(
    successResponse('Highlights', {
      items: page.items.map(toHighlightResponse),
      nextCursor: page.nextCursor,
    }),
  );
}

export async function createHighlightHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const highlight = await createHighlightService(
    user.id,
    workspaceId,
    req.body as CreateHighlightInput,
  );
  res.status(201).json(successResponse('Highlight saved', toHighlightResponse(highlight)));
}

export async function updateHighlightHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { highlightId } = res.locals.params as HighlightParams;
  const highlight = await updateHighlightService(
    user.id,
    highlightId,
    req.body as UpdateHighlightInput,
  );
  res.json(successResponse('Highlight updated', toHighlightResponse(highlight)));
}

export async function deleteHighlightHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { highlightId } = res.locals.params as HighlightParams;
  await deleteHighlightService(user.id, highlightId);
  res.status(204).end();
}
