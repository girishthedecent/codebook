import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { limit } from '../../middlewares/rateLimit.middleware.js';
import { graphRouter } from '../graph/graph.router.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { workspaceParamsSchema } from '../workspaces/workspace.validator.js';
import {
  createPdfSourceHandler,
  createSourceHandler,
  deleteSourceHandler,
  getContentHandler,
  getSourceHandler,
  getTocHandler,
  listFilesHandler,
  listSourcesHandler,
  resyncSourceHandler,
  sourceEventsHandler,
} from './source.controller.js';
import { receivePdf, requireWorkspaceWrite } from './source.upload.js';
import {
  createSourceSchema,
  listFilesQuerySchema,
  listSourcesQuerySchema,
  sourceContentQuerySchema,
  sourceParamsSchema,
  uploadFieldsSchema,
} from './source.validator.js';

// /workspaces/:workspaceId/sources. Mounted inside the workspace router, which has already
// run requireAuth, so the session isn't looked up twice.
export const workspaceSourcesRouter = express.Router({ mergeParams: true });

workspaceSourcesRouter.use(validateRequestParams(workspaceParamsSchema));

workspaceSourcesRouter.get('/', validateQueryParams(listSourcesQuerySchema), listSourcesHandler);

// PDFs arrive as multipart uploads, repos and websites as JSON, on the same path.
workspaceSourcesRouter.post(
  '/',
  (req, _res, next) => next(req.is('multipart/form-data') ? undefined : 'route'),
  requireWorkspaceWrite,
  // Counted before the upload, so a refused PDF is never stored.
  limit('sourceCreate'),
  receivePdf,
  validateRequestBody(uploadFieldsSchema),
  createPdfSourceHandler,
);
workspaceSourcesRouter.post(
  '/',
  validateRequestBody(createSourceSchema),
  limit('sourceCreate'),
  createSourceHandler,
);

// /sources/:sourceId
export const sourceRouter = express.Router();

sourceRouter.use(requireAuth);

sourceRouter.get('/:sourceId', validateRequestParams(sourceParamsSchema), getSourceHandler);
sourceRouter.delete('/:sourceId', validateRequestParams(sourceParamsSchema), deleteSourceHandler);
sourceRouter.post(
  '/:sourceId/resync',
  validateRequestParams(sourceParamsSchema),
  limit('resync'),
  resyncSourceHandler,
);
sourceRouter.get(
  '/:sourceId/events',
  validateRequestParams(sourceParamsSchema),
  sourceEventsHandler,
);
sourceRouter.get('/:sourceId/toc', validateRequestParams(sourceParamsSchema), getTocHandler);
sourceRouter.get(
  '/:sourceId/files',
  validateRequestParams(sourceParamsSchema),
  validateQueryParams(listFilesQuerySchema),
  listFilesHandler,
);
sourceRouter.get(
  '/:sourceId/content',
  validateRequestParams(sourceParamsSchema),
  validateQueryParams(sourceContentQuerySchema),
  getContentHandler,
);
sourceRouter.use('/:sourceId/graph', validateRequestParams(sourceParamsSchema), graphRouter);
