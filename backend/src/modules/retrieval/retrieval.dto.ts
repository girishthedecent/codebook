import type { z } from 'zod';
import type { searchBodySchema } from './retrieval.validator.js';

export type SearchInput = z.infer<typeof searchBodySchema>;
