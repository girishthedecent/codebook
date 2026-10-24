import prismaClient from '../../config/db.config.js';
import { Prisma, type SourceType } from '../../generated/prisma/client.js';

// Search reads child chunks only, always inside one workspace. Both searches return ids
// and scores; the chunks themselves are loaded once, for the ids that survive fusion.

export type ChunkFilters = {
  workspaceId: string;
  sourceIds?: string[];
  sourceTypes?: SourceType[];
  pathPrefix?: string;
};

export type ScoredId = { id: string; score: number };

export type ChunkRow = {
  id: string;
  parentId: string | null;
  sourceId: string;
  sourceTitle: string;
  sourceType: SourceType;
  documentPath: string;
  headingPath: string[];
  symbolName: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  content: string;
  context: string | null;
};

export type ParentRow = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  documentPath: string;
  headingPath: string[];
  content: string;
  tokenCount: number;
};

function filterSql({ workspaceId, sourceIds, sourceTypes, pathPrefix }: ChunkFilters) {
  const parts = [Prisma.sql`c."workspaceId" = ${workspaceId} AND c.kind = 'CHILD'`];
  if (sourceIds) parts.push(Prisma.sql`c."sourceId" = ANY(${sourceIds}::text[])`);
  if (sourceTypes) {
    parts.push(Prisma.sql`c."sourceId" IN (
      SELECT id FROM "Source" WHERE "workspaceId" = ${workspaceId}
        AND type::text = ANY(${sourceTypes}::text[]))`);
  }
  if (pathPrefix) {
    const pattern = `${pathPrefix.replace(/[\\%_]/g, '\\$&')}%`;
    parts.push(Prisma.sql`c."documentId" IN (
      SELECT d.id FROM "SourceDocument" d JOIN "Source" s ON s.id = d."sourceId"
      WHERE s."workspaceId" = ${workspaceId} AND d.path LIKE ${pattern})`);
  }
  return Prisma.join(parts, ' AND ');
}

/**
 * Nearest children by cosine similarity. On a big workspace Postgres walks the HNSW index,
 * and the iterative scan keeps walking until enough rows pass the filters; its order is
 * only roughly right, so the outer query sorts again. Small workspaces get an exact scan.
 */
export async function vectorSearch(
  vector: number[],
  filters: ChunkFilters,
  limit: number,
  efSearch: number,
): Promise<ScoredId[]> {
  const literal = `[${vector.join(',')}]`;
  // SET takes no bind parameters; set_config does, and `true` scopes it to the transaction.
  // Prisma's default 2s wait for a connection is short while the reranker keeps the CPU busy.
  return prismaClient.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('hnsw.ef_search', ${String(efSearch)}, true),
        set_config('hnsw.iterative_scan', 'relaxed_order', true)`;
      return tx.$queryRaw<ScoredId[]>`
        WITH nearest AS MATERIALIZED (
          SELECT c.id, c.embedding <=> ${literal}::vector AS distance
          FROM "SourceChunk" c
          WHERE ${filterSql(filters)} AND c.embedding IS NOT NULL
          ORDER BY distance
          LIMIT ${limit}
        )
        SELECT id, (1 - distance)::float8 AS score FROM nearest ORDER BY distance, id
      `;
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
}

/**
 * Full-text search where any of the words may match. websearch_to_tsquery would AND them,
 * and a question rarely has all its words in one chunk; ts_rank_cd still ranks chunks that
 * match more words higher. The text form of plainto_tsquery quotes every lexeme, so swapping
 * its & for | is safe, and casting straight to tsquery keeps the lexemes from being stemmed
 * a second time. `extraWords` (identifier parts) are ORed in the same way.
 */
export async function keywordSearch(
  query: string,
  extraWords: string,
  filters: ChunkFilters,
  limit: number,
): Promise<ScoredId[]> {
  return prismaClient.$queryRaw<ScoredId[]>`
    WITH q AS (
      SELECT replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery
        || replace(plainto_tsquery('english', ${extraWords})::text, ' & ', ' | ')::tsquery
        AS query
    )
    SELECT c.id, ts_rank_cd(c.tsv, q.query)::float8 AS score
    FROM "SourceChunk" c, q
    WHERE numnode(q.query) > 0 AND c.tsv @@ q.query AND ${filterSql(filters)}
    ORDER BY score DESC, c.id
    LIMIT ${limit}
  `;
}

export async function findChunks(workspaceId: string, ids: string[]): Promise<ChunkRow[]> {
  if (ids.length === 0) return [];
  return prismaClient.$queryRaw<ChunkRow[]>`
    SELECT c.id, c."parentId", c."sourceId", s.title AS "sourceTitle",
           s.type::text AS "sourceType", d.path AS "documentPath", c."headingPath",
           c."symbolName", c."pageStart", c."pageEnd", c."lineStart", c."lineEnd",
           c.content, c.context
    FROM "SourceChunk" c
    JOIN "Source" s ON s.id = c."sourceId"
    JOIN "SourceDocument" d ON d.id = c."documentId"
    WHERE c."workspaceId" = ${workspaceId} AND c.id = ANY(${ids}::text[])
  `;
}

export async function findParents(workspaceId: string, ids: string[]): Promise<ParentRow[]> {
  if (ids.length === 0) return [];
  return prismaClient.$queryRaw<ParentRow[]>`
    SELECT c.id, c."sourceId", s.title AS "sourceTitle", d.path AS "documentPath",
           c."headingPath", c.content, c."tokenCount"
    FROM "SourceChunk" c
    JOIN "Source" s ON s.id = c."sourceId"
    JOIN "SourceDocument" d ON d.id = c."documentId"
    WHERE c."workspaceId" = ${workspaceId} AND c.kind = 'PARENT' AND c.id = ANY(${ids}::text[])
  `;
}
