import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';

type CursorRow = { id: string; createdAt: Date };

// The cursor is the (createdAt, id) of the last row on the previous page. It is opaque to
// clients, so the format can change without breaking them.
const cursorValueSchema = z.tuple([z.iso.datetime(), z.string().min(1)]);

function encodeCursor(row: CursorRow) {
  const json = JSON.stringify([row.createdAt.toISOString(), row.id]);
  return Buffer.from(json).toString('base64url');
}

function decodeCursor(cursor: string): CursorRow | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const result = cursorValueSchema.safeParse(value);
  if (!result.success) return null;
  const [createdAt, id] = result.data;
  return { createdAt: new Date(createdAt), id };
}

export const paginationQuerySchema = z.object({
  cursor: z
    .string()
    .max(200)
    .transform((value, ctx) => {
      const cursor = decodeCursor(value);
      if (!cursor) {
        ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
        return z.NEVER;
      }
      return cursor;
    })
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(appConfig.pagination.maxLimit)
    .default(appConfig.pagination.defaultLimit),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type Page<T> = { items: T[]; nextCursor: string | null };

type CursorWhere =
  | { OR: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }] }
  | Record<string, never>;

export type PageQuery = {
  where: CursorWhere;
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }];
  take: number;
};

/**
 * Keyset pagination, newest first. `id` breaks ties between rows created in the same
 * millisecond, so no row is skipped or repeated between pages. `query` must spread the given
 * `where` into its own filter.
 */
export async function paginate<T extends CursorRow>(
  query: (page: PageQuery) => Promise<T[]>,
  { cursor, limit }: PaginationQuery,
): Promise<Page<T>> {
  const rows = await query({
    where: cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // One extra row tells us whether there is another page.
    take: limit + 1,
  });

  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}
