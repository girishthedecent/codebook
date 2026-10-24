import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';
import { Prisma, type EdgeType } from '../../generated/prisma/client.js';

// Graph walks are recursive CTEs over (symbol, via, depth) rows joined with UNION, which
// drops repeated rows: a walk produces at most edges × depth rows however many paths there
// are, and a cycle ends at the depth cap. A LIMIT right on the CTE stops Postgres early.

const SYMBOL_FIELDS = {
  id: true,
  name: true,
  qualifiedName: true,
  kind: true,
  filePath: true,
  lineStart: true,
  lineEnd: true,
  signature: true,
  exported: true,
  chunkId: true,
} as const;

export type GraphSymbol = Prisma.CodeSymbolGetPayload<{ select: typeof SYMBOL_FIELDS }>;
export type WalkRow = { id: string; via: string | null; depth: number };

export async function findSymbolById(sourceId: string, id: string) {
  return prismaClient.codeSymbol.findFirst({ where: { id, sourceId }, select: SYMBOL_FIELDS });
}

/** Symbols named exactly `name` (or with that qualified name), up to `limit`. */
export async function findSymbolsNamed(sourceId: string, name: string, limit: number) {
  const byQualified = await prismaClient.codeSymbol.findMany({
    where: { sourceId, qualifiedName: name },
    select: SYMBOL_FIELDS,
  });
  if (byQualified.length > 0) return byQualified;
  return prismaClient.codeSymbol.findMany({
    where: { sourceId, name },
    select: SYMBOL_FIELDS,
    orderBy: [{ filePath: 'asc' }, { lineStart: 'asc' }],
    take: limit,
  });
}

/** Search by name: exact matches first, then names and paths containing `q`; files last. */
export async function searchSymbols(sourceId: string, q: string, limit: number) {
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return prismaClient.$queryRaw<GraphSymbol[]>`
    SELECT id, name, "qualifiedName", kind::text AS kind, "filePath", "lineStart", "lineEnd",
           signature, exported, "chunkId"
    FROM "CodeSymbol"
    WHERE "sourceId" = ${sourceId}
      AND (name ILIKE ${pattern} OR "qualifiedName" ILIKE ${pattern})
    ORDER BY (name = ${q} OR "qualifiedName" = ${q}) DESC, (kind = 'FILE') ASC,
             length(name), "qualifiedName" COLLATE "C"
    LIMIT ${limit}
  `;
}

export async function findSymbols(ids: string[]) {
  if (ids.length === 0) return [];
  return prismaClient.codeSymbol.findMany({ where: { id: { in: ids } }, select: SYMBOL_FIELDS });
}

/**
 * Every symbol reachable from `start` over edges of `types`, forwards (what it uses) or
 * backwards (what uses it), up to `depth` hops. Resolved edges only.
 */
export async function walk(
  start: string,
  types: EdgeType[],
  direction: 'forward' | 'backward',
  depth: number,
): Promise<WalkRow[]> {
  const typeList = Prisma.join(types.map((type) => Prisma.sql`${type}::"EdgeType"`));
  const step =
    direction === 'forward'
      ? Prisma.sql`SELECT e."toSymbolId", w.id, w.depth + 1 FROM walk w
          JOIN "CodeEdge" e ON e."fromSymbolId" = w.id AND e."toSymbolId" IS NOT NULL`
      : Prisma.sql`SELECT e."fromSymbolId", w.id, w.depth + 1 FROM walk w
          JOIN "CodeEdge" e ON e."toSymbolId" = w.id`;
  return prismaClient.$queryRaw<WalkRow[]>`
    WITH RECURSIVE walk(id, via, depth) AS (
      SELECT ${start}::text, NULL::text, 0
      UNION
      ${step} AND e.type IN (${typeList})
      WHERE w.depth < ${depth}
    )
    SELECT id, via, depth FROM walk LIMIT ${appConfig.graph.maxWalkRows}
  `;
}

/** Edges out of these symbols that point outside the repository (or weren't resolved). */
export async function unresolvedEdges(fromIds: string[], types: EdgeType[], limit: number) {
  if (fromIds.length === 0) return [];
  return prismaClient.codeEdge.findMany({
    where: { fromSymbolId: { in: fromIds }, toSymbolId: null, type: { in: types } },
    select: { fromSymbolId: true, toName: true, type: true, filePath: true, line: true },
    orderBy: [{ filePath: 'asc' }, { line: 'asc' }],
    take: limit,
  });
}
