import type { Request, Response } from 'express';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type { FailedQueriesQuery, StatsQuery } from './monitoring.dto.js';
import { failedQueriesService, statsService } from './monitoring.service.js';

export async function statsHandler(_req: Request, res: Response) {
  const query = res.locals.query as StatsQuery;
  res.json(successResponse('Monitoring stats', await statsService(query)));
}

export async function failedQueriesHandler(_req: Request, res: Response) {
  const query = res.locals.query as FailedQueriesQuery;
  res.json(successResponse('Failed queries', await failedQueriesService(query)));
}
