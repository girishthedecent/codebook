import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import { text } from '../sources/source.validator.js';

const { maxDepth, maxResults } = appConfig.graph;

// An id, a qualified name (`src/auth.ts#AuthService.login`) or a plain name.
const symbolRef = text(1_000);
const depth = z.coerce.number().int().min(1).max(maxDepth).default(2);

export const symbolsQuerySchema = z.object({
  q: text(200),
  limit: z.coerce.number().int().min(1).max(maxResults).default(20),
});

export const walkQuerySchema = z.object({ symbol: symbolRef, depth });

export const dependenciesQuerySchema = walkQuerySchema;

export const pathQuerySchema = z.object({
  from: symbolRef,
  to: symbolRef,
  imports: z.stringbool().default(false),
});
