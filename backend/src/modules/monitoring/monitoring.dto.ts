import type { z } from 'zod';
import type {
  failedQueriesQuerySchema,
  ingestionFailuresQuerySchema,
  rangeQuerySchema,
  statsQuerySchema,
} from './monitoring.validator.js';

export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type RangeQuery = z.infer<typeof rangeQuerySchema>;
export type IngestionFailuresQuery = z.infer<typeof ingestionFailuresQuerySchema>;
export type FailedQueriesQuery = z.infer<typeof failedQueriesQuerySchema>;

export type FailureReason = 'thumbs_down' | 'error' | 'invalid_citations' | 'weak_retrieval';
