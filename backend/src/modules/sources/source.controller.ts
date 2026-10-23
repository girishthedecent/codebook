import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import type { PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import { openSse } from '../../utils/sse.js';
import type { WorkspaceParams } from '../workspaces/workspace.dto.js';
import {
  toSourceResponse,
  type CreateSourceInput,
  type SourceContentQuery,
  type SourceParams,
  type UploadFields,
} from './source.dto.js';
import {
  createPdfSourceService,
  createSourceService,
  deleteSourceService,
  getSourceService,
  listSourcesService,
  resyncSourceService,
  watchSourceProgress,
} from './source.service.js';
import { getContentService, getTocService, listFilesService } from './sourceContent.service.js';

export async function createSourceHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const source = await createSourceService(user.id, workspaceId, req.body as CreateSourceInput);
  res.status(201).json(successResponse('Source added', toSourceResponse(source)));
}

export async function createPdfSourceHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  // receivePdf guarantees the file and deletes it when the response closes.
  const file = req.file!;
  const source = await createPdfSourceService(
    user.id,
    workspaceId,
    { path: file.path, originalName: file.originalname, size: file.size },
    req.body as UploadFields,
  );
  res.status(201).json(successResponse('Source added', toSourceResponse(source)));
}

export async function listSourcesHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const page = await listSourcesService(user.id, workspaceId, res.locals.query as PaginationQuery);
  res.json(
    successResponse('Sources', {
      items: page.items.map(toSourceResponse),
      nextCursor: page.nextCursor,
    }),
  );
}

export async function getSourceHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  const source = await getSourceService(user.id, sourceId);
  res.json(successResponse('Source', toSourceResponse(source)));
}

export async function deleteSourceHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  await deleteSourceService(user.id, sourceId);
  res.status(204).end();
}

export async function resyncSourceHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  const source = await resyncSourceService(user.id, sourceId);
  res.status(202).json(successResponse('Resync queued', toSourceResponse(source)));
}

export async function sourceEventsHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  // Checked before the stream opens, so a missing source is a normal JSON 404.
  await getSourceService(user.id, sourceId);
  watchSourceProgress(sourceId, openSse(req, res));
}

export async function getTocHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  res.json(successResponse('Table of contents', await getTocService(user.id, sourceId)));
}

export async function listFilesHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  const page = await listFilesService(user.id, sourceId, res.locals.query as PaginationQuery);
  res.json(successResponse('Files', page));
}

export async function getContentHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  const query = res.locals.query as SourceContentQuery;
  res.json(successResponse('Content', await getContentService(user.id, sourceId, query)));
}
