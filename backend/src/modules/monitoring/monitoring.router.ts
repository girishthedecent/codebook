import express from 'express';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { validateQueryParams } from '../../middlewares/validator.middleware.js';
import { failedQueriesHandler, statsHandler } from './monitoring.controller.js';
import { failedQueriesQuerySchema, statsQuerySchema } from './monitoring.validator.js';

// /monitoring/stats and /monitoring/failed-queries, admins only.
export const monitoringRouter = express.Router();

// Before validation, so a non-admin gets the plain 404 even for a bad query string.
monitoringRouter.use(requireAdmin);

monitoringRouter.get('/stats', validateQueryParams(statsQuerySchema), statsHandler);
monitoringRouter.get(
  '/failed-queries',
  validateQueryParams(failedQueriesQuerySchema),
  failedQueriesHandler,
);
