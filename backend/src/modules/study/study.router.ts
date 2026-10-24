import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { limit } from '../../middlewares/rateLimit.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { workspaceParamsSchema } from '../workspaces/workspace.validator.js';
import {
  createStudyHandler,
  deleteStudyHandler,
  getStudyHandler,
  listStudyHandler,
  regenerateStudyHandler,
} from './study.controller.js';
import { createStudySchema, listStudyQuerySchema, studyParamsSchema } from './study.validator.js';

// /workspaces/:workspaceId/study. Mounted inside the workspace router, which has already
// run requireAuth.
export const workspaceStudyRouter = express.Router({ mergeParams: true });

workspaceStudyRouter.use(validateRequestParams(workspaceParamsSchema));

workspaceStudyRouter.get('/', validateQueryParams(listStudyQuerySchema), listStudyHandler);
workspaceStudyRouter.post(
  '/',
  validateRequestBody(createStudySchema),
  limit('study'),
  createStudyHandler,
);

// /study/:studyId
export const studyRouter = express.Router();

studyRouter.use(requireAuth);

studyRouter.get('/:studyId', validateRequestParams(studyParamsSchema), getStudyHandler);
studyRouter.delete('/:studyId', validateRequestParams(studyParamsSchema), deleteStudyHandler);
studyRouter.post(
  '/:studyId/regenerate',
  validateRequestParams(studyParamsSchema),
  limit('study'),
  regenerateStudyHandler,
);
