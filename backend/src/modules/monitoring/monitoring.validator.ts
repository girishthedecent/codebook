import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/helpers/pagination.helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 90;

const rangeFields = {
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};

// Defaults to the last 7 days, ending now.
function toRange<T extends { from?: string; to?: string }>({ from, to, ...rest }: T) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 7 * DAY_MS);
  return { ...rest, from: start, to: end };
}

function validRange<S extends z.ZodType<{ from: Date; to: Date }>>(schema: S) {
  return schema
    .refine(({ from, to }) => from < to, { message: '`from` must be before `to`', path: ['from'] })
    .refine(({ from, to }) => to.getTime() - from.getTime() <= MAX_RANGE_DAYS * DAY_MS, {
      message: `The range can be at most ${MAX_RANGE_DAYS} days`,
      path: ['from'],
    });
}

// System users (the eval runner, the demo's owner) make traffic of their own; the numbers are
// about real users unless this is on.
const includeSystem = z.stringbool().default(false);

export const statsQuerySchema = validRange(
  z.object({ ...rangeFields, includeSystem }).transform(toRange),
);

export const rangeQuerySchema = validRange(z.object(rangeFields).transform(toRange));

export const failedQueriesQuerySchema = paginationQuerySchema;

export const ingestionFailuresQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  includeSystem,
});
