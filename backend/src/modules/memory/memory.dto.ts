import type { z } from 'zod';
import type { Memory } from '../../generated/prisma/client.js';
import type {
  createMemorySchema,
  listMemoriesQuerySchema,
  memoryParamsSchema,
  updateMemorySchema,
} from './memory.validator.js';

export type MemoryParams = z.infer<typeof memoryParamsSchema>;
export type ListMemoriesQuery = z.infer<typeof listMemoriesQuerySchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;

export function toMemoryResponse(memory: Memory) {
  return {
    id: memory.id,
    kind: memory.kind,
    content: memory.content,
    importance: memory.importance,
    sourceMessageId: memory.sourceMessageId,
    lastUsedAt: memory.lastUsedAt,
    deletedAt: memory.deletedAt,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}
