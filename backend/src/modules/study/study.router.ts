import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { limit } from '../../middlewares/rateLimit.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { forbidGuests } from '../demo/demo.middleware.js';
import { workspaceParamsSchema } from '../workspaces/workspace.validator.js';
import {
  cancelStudyHandler,
  createStudyHandler,
  deleteStudyHandler,
  getStudyHandler,
  listStudyHandler,
  regenerateStudyHandler,
} from './study.controller.js';
import { createStudySchema, listStudyQuerySchema, studyParamsSchema } from './study.validator.js';

// Study sets cost model calls and stay with their workspace's owner; guests only read the
// demo's.
const noGuests = forbidGuests('Guests cannot make study sets');

// /workspaces/:workspaceId/study. Mounted inside the workspace router, which has already
// run requireAuth.
export const workspaceStudyRouter = express.Router({ mergeParams: true });

workspaceStudyRouter.use(validateRequestParams(workspaceParamsSchema));

workspaceStudyRouter.get('/', validateQueryParams(listStudyQuerySchema), listStudyHandler);
workspaceStudyRouter.post(
  '/',
  noGuests,
  validateRequestBody(createStudySchema),
  limit('study'),
  createStudyHandler,
);

// /study/:studyId
export const studyRouter = express.Router();

studyRouter.use(requireAuth);

studyRouter.get('/:studyId', validateRequestParams(studyParamsSchema), getStudyHandler);
studyRouter.delete(
  '/:studyId',
  noGuests,
  validateRequestParams(studyParamsSchema),
  deleteStudyHandler,
);
studyRouter.post(
  '/:studyId/regenerate',
  noGuests,
  validateRequestParams(studyParamsSchema),
  limit('study'),
  regenerateStudyHandler,
);
studyRouter.post(
  '/:studyId/cancel',
  noGuests,
  validateRequestParams(studyParamsSchema),
  cancelStudyHandler,
);
