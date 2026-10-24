import type { z } from 'zod';
import type { failedQueriesQuerySchema, statsQuerySchema } from './monitoring.validator.js';

export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type FailedQueriesQuery = z.infer<typeof failedQueriesQuerySchema>;

export type FailureReason = 'thumbs_down' | 'error' | 'invalid_citations' | 'weak_retrieval';
