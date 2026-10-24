import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import { SourceType } from '../../generated/prisma/enums.js';
import { text } from '../sources/source.validator.js';
import { SEARCH_MODES } from '../workspaces/workspace.validator.js';
import { QUERY_MODES } from './retrieval.types.js';

const { maxQueryChars, maxSourceIds, maxTopK, defaultTopK } = appConfig.retrieval;

export const searchBodySchema = z.object({
  query: text(maxQueryChars),
  // Defaults to the workspace's setting.
  mode: z.enum(SEARCH_MODES).optional(),
  queryMode: z.enum(QUERY_MODES).default('none'),
  // Defaults to appConfig.retrieval.rerankByDefault (for owners).
  rerank: z.boolean().optional(),
  topK: z.number().int().min(1).max(maxTopK).default(defaultTopK),
  sourceIds: z
    .array(z.cuid())
    .min(1)
    .max(maxSourceIds)
    .transform((ids) => [...new Set(ids)])
    .optional(),
  sourceTypes: z
    .array(z.enum(SourceType))
    .min(1)
    .transform((types) => [...new Set(types)])
    .optional(),
  pathPrefix: text(1_000).optional(),
  expandParents: z.boolean().default(true),
});
