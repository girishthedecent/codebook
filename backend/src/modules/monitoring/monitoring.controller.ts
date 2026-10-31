import type { Request, Response } from 'express';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type {
  FailedQueriesQuery,
  IngestionFailuresQuery,
  RangeQuery,
  StatsQuery,
} from './monitoring.dto.js';
import {
  circuitBreakerService,
  failedQueriesService,
  ingestionFailuresService,
  modelUsageService,
  rateLimitsService,
  statsService,
} from './monitoring.service.js';

export async function statsHandler(_req: Request, res: Response) {
  const query = res.locals.query as StatsQuery;
  res.json(successResponse('Monitoring stats', await statsService(query)));
}

export async function failedQueriesHandler(_req: Request, res: Response) {
  const query = res.locals.query as FailedQueriesQuery;
  res.json(successResponse('Failed queries', await failedQueriesService(query)));
}

export async function modelUsageHandler(_req: Request, res: Response) {
  const query = res.locals.query as StatsQuery;
  res.json(successResponse('Model usage', await modelUsageService(query)));
}

export async function ingestionFailuresHandler(_req: Request, res: Response) {
  const query = res.locals.query as IngestionFailuresQuery;
  res.json(successResponse('Ingestion failures', await ingestionFailuresService(query)));
}

export async function rateLimitsHandler(_req: Request, res: Response) {
  const query = res.locals.query as RangeQuery;
  res.json(successResponse('Rate limits', await rateLimitsService(query)));
}

export function circuitBreakerHandler(_req: Request, res: Response) {
  res.json(successResponse('Circuit breaker', circuitBreakerService()));
}
