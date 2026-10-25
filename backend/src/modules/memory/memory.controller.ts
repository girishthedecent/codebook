import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import {
  toMemoryResponse,
  type CreateMemoryInput,
  type ListMemoriesQuery,
  type MemoryParams,
  type UpdateMemoryInput,
} from './memory.dto.js';
import {
  clearMemoriesService,
  createMemoryService,
  deleteMemoryService,
  listMemoriesService,
  restoreMemoryService,
  updateMemoryService,
} from './memory.service.js';

export async function listMemoriesHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const memories = await listMemoriesService(user.id, res.locals.query as ListMemoriesQuery);
  res.json(successResponse('Memories', { items: memories.map(toMemoryResponse) }));
}

export async function createMemoryHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const memory = await createMemoryService(user.id, req.body as CreateMemoryInput);
  res.status(201).json(successResponse('Memory added', toMemoryResponse(memory)));
}

export async function updateMemoryHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { memoryId } = res.locals.params as MemoryParams;
  const memory = await updateMemoryService(user.id, memoryId, req.body as UpdateMemoryInput);
  res.json(successResponse('Memory updated', toMemoryResponse(memory)));
}

export async function deleteMemoryHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { memoryId } = res.locals.params as MemoryParams;
  await deleteMemoryService(user.id, memoryId);
  res.status(204).end();
}

export async function restoreMemoryHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { memoryId } = res.locals.params as MemoryParams;
  const memory = await restoreMemoryService(user.id, memoryId);
  res.json(successResponse('Memory restored', toMemoryResponse(memory)));
}

export async function clearMemoriesHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const deleted = await clearMemoriesService(user.id);
  res.json(successResponse('Memories cleared', { deleted }));
}
