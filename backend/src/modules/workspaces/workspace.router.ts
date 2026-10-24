import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { searchHandler } from '../retrieval/retrieval.controller.js';
import { searchBodySchema } from '../retrieval/retrieval.validator.js';
import { workspaceSourcesRouter } from '../sources/source.router.js';
import {
  createWorkspaceHandler,
  deleteWorkspaceHandler,
  getWorkspaceHandler,
  listWorkspacesHandler,
  updateWorkspaceHandler,
} from './workspace.controller.js';
import {
  createWorkspaceSchema,
  listWorkspacesQuerySchema,
  updateWorkspaceSchema,
  workspaceParamsSchema,
} from './workspace.validator.js';

const workspaceRouter = express.Router();

workspaceRouter.use(requireAuth);

workspaceRouter.get('/', validateQueryParams(listWorkspacesQuerySchema), listWorkspacesHandler);
workspaceRouter.post('/', validateRequestBody(createWorkspaceSchema), createWorkspaceHandler);

workspaceRouter.get(
  '/:workspaceId',
  validateRequestParams(workspaceParamsSchema),
  getWorkspaceHandler,
);
workspaceRouter.patch(
  '/:workspaceId',
  validateRequestParams(workspaceParamsSchema),
  validateRequestBody(updateWorkspaceSchema),
  updateWorkspaceHandler,
);
workspaceRouter.delete(
  '/:workspaceId',
  validateRequestParams(workspaceParamsSchema),
  deleteWorkspaceHandler,
);

workspaceRouter.post(
  '/:workspaceId/search',
  validateRequestParams(workspaceParamsSchema),
  validateRequestBody(searchBodySchema),
  searchHandler,
);

// Behind this router's requireAuth; see source.router.ts.
workspaceRouter.use('/:workspaceId/sources', workspaceSourcesRouter);

export default workspaceRouter;
