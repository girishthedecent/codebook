import type { z } from 'zod';
import type {
  compareQuerySchema,
  createRunSchema,
  listRunsQuerySchema,
  resultsQuerySchema,
  runParamsSchema,
} from './evals.validator.js';

export type RunParams = z.infer<typeof runParamsSchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type ResultsQuery = z.infer<typeof resultsQuerySchema>;
export type CompareQuery = z.infer<typeof compareQuerySchema>;
export type CreateRunInput = z.infer<typeof createRunSchema>;
