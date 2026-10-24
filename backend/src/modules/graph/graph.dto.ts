import type { z } from 'zod';
import type {
  dependenciesQuerySchema,
  pathQuerySchema,
  symbolsQuerySchema,
  walkQuerySchema,
} from './graph.validator.js';

export type SymbolsQuery = z.infer<typeof symbolsQuerySchema>;
export type WalkQuery = z.infer<typeof walkQuerySchema>;
export type DependenciesQuery = z.infer<typeof dependenciesQuerySchema>;
export type PathQuery = z.infer<typeof pathQuerySchema>;
