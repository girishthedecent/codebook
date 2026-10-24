import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/helpers/pagination.helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 90;

// Defaults to the last 7 days, ending now.
export const statsQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .transform(({ from, to }) => {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 7 * DAY_MS);
    return { from: start, to: end };
  })
  .refine(({ from, to }) => from < to, { message: '`from` must be before `to`', path: ['from'] })
  .refine(({ from, to }) => to.getTime() - from.getTime() <= MAX_RANGE_DAYS * DAY_MS, {
    message: `The range can be at most ${MAX_RANGE_DAYS} days`,
    path: ['from'],
  });

export const failedQueriesQuerySchema = paginationQuerySchema;
