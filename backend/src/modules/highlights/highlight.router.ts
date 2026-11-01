import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { forbidGuests } from '../demo/demo.middleware.js';
import { workspaceParamsSchema } from '../workspaces/workspace.validator.js';
import {
  createHighlightHandler,
  deleteHighlightHandler,
  listHighlightsHandler,
  updateHighlightHandler,
} from './highlight.controller.js';
import {
  createHighlightSchema,
  highlightParamsSchema,
  listHighlightsQuerySchema,
  updateHighlightSchema,
} from './highlight.validator.js';

const noGuests = forbidGuests('Guests cannot keep highlights. Sign up to mark passages.');

// /workspaces/:workspaceId/highlights. Mounted inside the workspace router, which has already
// run requireAuth.
export const workspaceHighlightsRouter = express.Router({ mergeParams: true });

workspaceHighlightsRouter.use(validateRequestParams(workspaceParamsSchema));

workspaceHighlightsRouter.get(
  '/',
  validateQueryParams(listHighlightsQuerySchema),
  listHighlightsHandler,
);
workspaceHighlightsRouter.post(
  '/',
  noGuests,
  validateRequestBody(createHighlightSchema),
  createHighlightHandler,
);

// /highlights/:highlightId
export const highlightRouter = express.Router();

highlightRouter.use(requireAuth);

highlightRouter.patch(
  '/:highlightId',
  noGuests,
  validateRequestParams(highlightParamsSchema),
  validateRequestBody(updateHighlightSchema),
  updateHighlightHandler,
);
highlightRouter.delete(
  '/:highlightId',
  noGuests,
  validateRequestParams(highlightParamsSchema),
  deleteHighlightHandler,
);
