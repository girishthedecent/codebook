import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type { SourceParams } from '../sources/source.dto.js';
import type { DependenciesQuery, PathQuery, SymbolsQuery, WalkQuery } from './graph.dto.js';
import {
  callersService,
  dependenciesService,
  pathService,
  searchSymbolsService,
} from './graph.service.js';

export async function symbolsHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  const query = res.locals.query as SymbolsQuery;
  res.json(successResponse('Symbols', await searchSymbolsService(user.id, sourceId, query)));
}

export async function callersHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  const query = res.locals.query as WalkQuery;
  res.json(successResponse('Callers', await callersService(user.id, sourceId, query)));
}

export async function dependenciesHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  const query = res.locals.query as DependenciesQuery;
  res.json(successResponse('Dependencies', await dependenciesService(user.id, sourceId, query)));
}

export async function pathHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { sourceId } = res.locals.params as SourceParams;
  const query = res.locals.query as PathQuery;
  res.json(successResponse('Path', await pathService(user.id, sourceId, query)));
}
