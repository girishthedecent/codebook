import express, { type NextFunction, type Request, type Response } from 'express';
import { getAuthUser, requireAuth } from '../../middlewares/auth.middleware.js';
import { limit } from '../../middlewares/rateLimit.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { ForbiddenError } from '../../utils/errors/app.error.js';
import {
  clearMemoriesHandler,
  createMemoryHandler,
  deleteMemoryHandler,
  listMemoriesHandler,
  restoreMemoryHandler,
  updateMemoryHandler,
} from './memory.controller.js';
import {
  createMemorySchema,
  listMemoriesQuerySchema,
  memoryParamsSchema,
  updateMemorySchema,
} from './memory.validator.js';

// Guest accounts are throwaway and shared-looking (the demo): nothing is remembered for them.
function rejectGuests(_req: Request, res: Response, next: NextFunction) {
  next(getAuthUser(res).isGuest ? new ForbiddenError('Guests have no memory') : undefined);
}

// /memories
export const memoryRouter = express.Router();

memoryRouter.use(requireAuth, rejectGuests);

memoryRouter.get('/', validateQueryParams(listMemoriesQuerySchema), listMemoriesHandler);
memoryRouter.post(
  '/',
  validateRequestBody(createMemorySchema),
  limit('memoryWrites'),
  createMemoryHandler,
);
memoryRouter.delete('/', clearMemoriesHandler);
memoryRouter.patch(
  '/:memoryId',
  validateRequestParams(memoryParamsSchema),
  validateRequestBody(updateMemorySchema),
  limit('memoryWrites'),
  updateMemoryHandler,
);
memoryRouter.delete('/:memoryId', validateRequestParams(memoryParamsSchema), deleteMemoryHandler);
memoryRouter.post(
  '/:memoryId/restore',
  validateRequestParams(memoryParamsSchema),
  restoreMemoryHandler,
);
