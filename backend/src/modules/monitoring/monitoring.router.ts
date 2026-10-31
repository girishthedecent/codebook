import express from 'express';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { validateQueryParams } from '../../middlewares/validator.middleware.js';
import {
  circuitBreakerHandler,
  failedQueriesHandler,
  ingestionFailuresHandler,
  modelUsageHandler,
  rateLimitsHandler,
  statsHandler,
} from './monitoring.controller.js';
import {
  failedQueriesQuerySchema,
  ingestionFailuresQuerySchema,
  rangeQuerySchema,
  statsQuerySchema,
} from './monitoring.validator.js';

// /monitoring: stats, failed answers, model usage, ingestion failures, rate limits and the
// circuit breaker, admins only.
export const monitoringRouter = express.Router();

// Before validation, so a non-admin gets the plain 404 even for a bad query string.
monitoringRouter.use(requireAdmin);

monitoringRouter.get('/stats', validateQueryParams(statsQuerySchema), statsHandler);
monitoringRouter.get(
  '/failed-queries',
  validateQueryParams(failedQueriesQuerySchema),
  failedQueriesHandler,
);
monitoringRouter.get('/models', validateQueryParams(statsQuerySchema), modelUsageHandler);
monitoringRouter.get(
  '/ingestion-failures',
  validateQueryParams(ingestionFailuresQuerySchema),
  ingestionFailuresHandler,
);
monitoringRouter.get('/rate-limits', validateQueryParams(rangeQuerySchema), rateLimitsHandler);
monitoringRouter.get('/circuit-breaker', circuitBreakerHandler);
