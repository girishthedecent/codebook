import { z } from 'zod';
import { EvalCaseType, EvalSplit } from '../../generated/prisma/enums.js';

// Suite, config and dataset names are file names under evals/; the worker checks they exist.
const name = z
  .string()
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'only lowercase letters, digits and dashes');

export const runParamsSchema = z.object({ runId: z.cuid() });

// Newest first. Runs are few (a handful a day at most), so a limit does without a cursor.
export const listRunsQuerySchema = z.object({
  suite: name.optional(),
  dataset: name.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const resultsQuerySchema = z.object({
  type: z.enum(EvalCaseType).optional(),
  // Only the cases that failed: an error, or a score short of full marks.
  failed: z.stringbool().default(false),
});

export const compareQuerySchema = z.object({
  runs: z
    .string()
    .transform((value) => value.split(',').map((id) => id.trim()))
    .pipe(
      z
        .array(z.cuid())
        .length(2, 'give two run ids: runs=a,b')
        .refine(([a, b]) => a !== b, 'the two runs must differ'),
    ),
});

export const createRunSchema = z.object({
  suite: name,
  config: name,
  dataset: name.default('core'),
  split: z.enum(EvalSplit).default('DEV'),
  limit: z.int().min(1).max(500).optional(),
  tags: z
    .array(
      z
        .string()
        .max(64)
        .regex(/^[a-z0-9:_-]+$/i),
    )
    .max(20)
    .optional(),
  resume: z.cuid().optional(),
});
