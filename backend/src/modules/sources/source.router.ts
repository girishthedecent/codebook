import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
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
  getSourceHandler,
  listSourcesHandler,
  resyncSourceHandler,
  sourceEventsHandler,
} from './source.controller.js';
import { receivePdf, requireWorkspaceWrite } from './source.upload.js';
import {
  createSourceSchema,
  listSourcesQuerySchema,
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
  receivePdf,
  validateRequestBody(uploadFieldsSchema),
  createPdfSourceHandler,
);
workspaceSourcesRouter.post('/', validateRequestBody(createSourceSchema), createSourceHandler);

// /sources/:sourceId
export const sourceRouter = express.Router();

sourceRouter.use(requireAuth);

sourceRouter.get('/:sourceId', validateRequestParams(sourceParamsSchema), getSourceHandler);
sourceRouter.delete('/:sourceId', validateRequestParams(sourceParamsSchema), deleteSourceHandler);
sourceRouter.post(
  '/:sourceId/resync',
  validateRequestParams(sourceParamsSchema),
  resyncSourceHandler,
);
sourceRouter.get(
  '/:sourceId/events',
  validateRequestParams(sourceParamsSchema),
  sourceEventsHandler,
);
