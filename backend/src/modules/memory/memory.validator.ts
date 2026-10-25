import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import { MemoryKind } from '../../generated/prisma/enums.js';
import { text } from '../sources/source.validator.js';

const content = text(appConfig.memory.maxContentChars).trim().min(1);
const importance = z.int().min(1).max(5);

export const memoryParamsSchema = z.object({ memoryId: z.cuid() });

export const listMemoriesQuerySchema = z.object({
  kind: z.enum(MemoryKind).optional(),
  includeDeleted: z
    .enum(['0', '1', 'true', 'false'])
    .default('0')
    .transform((value) => value === '1' || value === 'true'),
});

export const createMemorySchema = z.object({
  kind: z.enum(MemoryKind),
  content,
  importance: importance.optional(),
});

export const updateMemorySchema = z
  .object({ content: content.optional(), importance: importance.optional() })
  .refine(
    (input) => input.content !== undefined || input.importance !== undefined,
    'Send content or importance',
  );
