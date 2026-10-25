import express from 'express';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import {
  compareRunsHandler,
  getRunHandler,
  listDatasetsHandler,
  listResultsHandler,
  listRunsHandler,
  requestRunHandler,
} from './evals.controller.js';
import {
  compareQuerySchema,
  createRunSchema,
  listRunsQuerySchema,
  resultsQuerySchema,
  runParamsSchema,
} from './evals.validator.js';

// /evals: datasets, runs, results and comparisons, plus queueing a run. Admins only, reads
// too: results and run configs come from the eval corpus and the eval user's workspace.
export const evalsRouter = express.Router();

// Before validation, so a non-admin gets the plain 404 even for a bad request.
evalsRouter.use(requireAdmin);

evalsRouter.get('/datasets', listDatasetsHandler);
evalsRouter.get('/runs', validateQueryParams(listRunsQuerySchema), listRunsHandler);
evalsRouter.post('/runs', validateRequestBody(createRunSchema), requestRunHandler);
evalsRouter.get('/runs/:runId', validateRequestParams(runParamsSchema), getRunHandler);
evalsRouter.get(
  '/runs/:runId/results',
  validateRequestParams(runParamsSchema),
  validateQueryParams(resultsQuerySchema),
  listResultsHandler,
);
evalsRouter.get('/compare', validateQueryParams(compareQuerySchema), compareRunsHandler);
