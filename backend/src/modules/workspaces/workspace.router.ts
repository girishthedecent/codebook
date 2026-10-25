import express from 'express';
import { limit } from '../../middlewares/rateLimit.middleware.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { workspaceConversationsRouter } from '../chat/conversation.router.js';
import { forbidGuests } from '../demo/demo.middleware.js';
import { searchHandler } from '../retrieval/retrieval.controller.js';
import { searchBodySchema } from '../retrieval/retrieval.validator.js';
import { workspaceSourcesRouter } from '../sources/source.router.js';
import { workspaceStudyRouter } from '../study/study.router.js';
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
workspaceRouter.post(
  '/',
  forbidGuests('Guests can only use the demo workspace. Sign up to create your own.'),
  validateRequestBody(createWorkspaceSchema),
  createWorkspaceHandler,
);

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
  limit('search'),
  searchHandler,
);

// Behind this router's requireAuth; see source.router.ts.
workspaceRouter.use('/:workspaceId/sources', workspaceSourcesRouter);
workspaceRouter.use('/:workspaceId/conversations', workspaceConversationsRouter);
workspaceRouter.use('/:workspaceId/study', workspaceStudyRouter);

export default workspaceRouter;
