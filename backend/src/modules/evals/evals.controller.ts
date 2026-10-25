import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type {
  CompareQuery,
  CreateRunInput,
  ListRunsQuery,
  ResultsQuery,
  RunParams,
} from './evals.dto.js';
import {
  compareRunsService,
  getRunService,
  listDatasetsService,
  listResultsService,
  listRunsService,
  requestRunService,
} from './evals.service.js';

export async function listDatasetsHandler(_req: Request, res: Response) {
  res.json(successResponse('Eval datasets', await listDatasetsService()));
}

export async function listRunsHandler(_req: Request, res: Response) {
  const query = res.locals.query as ListRunsQuery;
  res.json(successResponse('Eval runs', await listRunsService(query)));
}

export async function getRunHandler(_req: Request, res: Response) {
  const { runId } = res.locals.params as RunParams;
  res.json(successResponse('Eval run', await getRunService(runId)));
}

export async function listResultsHandler(_req: Request, res: Response) {
  const { runId } = res.locals.params as RunParams;
  const query = res.locals.query as ResultsQuery;
  res.json(successResponse('Eval results', await listResultsService(runId, query)));
}

export async function compareRunsHandler(_req: Request, res: Response) {
  const query = res.locals.query as CompareQuery;
  res.json(successResponse('Eval comparison', await compareRunsService(query)));
}

export async function requestRunHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const run = await requestRunService(req.body as CreateRunInput, user.id);
  res.status(202).json(successResponse('Eval run queued', run));
}
