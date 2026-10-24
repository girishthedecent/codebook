import express from 'express';
import { validateQueryParams } from '../../middlewares/validator.middleware.js';
import {
  callersHandler,
  dependenciesHandler,
  pathHandler,
  symbolsHandler,
} from './graph.controller.js';
import {
  dependenciesQuerySchema,
  pathQuerySchema,
  symbolsQuerySchema,
  walkQuerySchema,
} from './graph.validator.js';

// /sources/:sourceId/graph. Mounted inside the source router, which has already checked
// the session and validated :sourceId.
export const graphRouter = express.Router({ mergeParams: true });

graphRouter.get('/symbols', validateQueryParams(symbolsQuerySchema), symbolsHandler);
graphRouter.get('/callers', validateQueryParams(walkQuerySchema), callersHandler);
graphRouter.get('/dependencies', validateQueryParams(dependenciesQuerySchema), dependenciesHandler);
graphRouter.get('/path', validateQueryParams(pathQuerySchema), pathHandler);
