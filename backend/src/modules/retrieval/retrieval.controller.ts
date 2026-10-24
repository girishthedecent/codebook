import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type { WorkspaceParams } from '../workspaces/workspace.dto.js';
import type { SearchInput } from './retrieval.dto.js';
import { searchWorkspaceService } from './retrieval.service.js';

export async function searchHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  // A client that goes away stops the embedding, model and reranker work it started.
  const aborted = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) aborted.abort();
  });
  const result = await searchWorkspaceService(
    user.id,
    workspaceId,
    req.body as SearchInput,
    aborted.signal,
  );
  res.json(successResponse('Search results', result));
}
