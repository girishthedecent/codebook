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

// What the constructor of a class is called in the languages the graph reads.
export const CONSTRUCTOR_NAMES = ['__init__', 'constructor'];
const IMPORT_REGION_CHARS = 20_000;

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
 * Every symbol reachable from `starts` over edges of `types`, forwards (what they use) or
 * backwards (what uses them), up to `depth` hops. Resolved edges only.
 *
 * A class and its constructor are one node to the walk: calls of `Block(config)` are recorded
 * against the class, and what the constructor calls is what building the class calls. At a
 * node either one, the walk goes on with the edges of both, and the hop counts once.
 */
export async function walk(
  sourceId: string,
  starts: string[],
  types: EdgeType[],
  direction: 'forward' | 'backward',
  depth: number,
): Promise<WalkRow[]> {
  const typeList = Prisma.join(types.map((type) => Prisma.sql`${type}::"EdgeType"`));
  const step =
    direction === 'forward'
      ? Prisma.sql`SELECT e."toSymbolId", w.id, w.depth + 1 FROM walk w
          LEFT JOIN pair p ON p.a = w.id
          JOIN "CodeEdge" e ON e."fromSymbolId" IN (w.id, p.b) AND e."toSymbolId" IS NOT NULL`
      : Prisma.sql`SELECT e."fromSymbolId", w.id, w.depth + 1 FROM walk w
          LEFT JOIN pair p ON p.a = w.id
          JOIN "CodeEdge" e ON e."toSymbolId" IN (w.id, p.b)`;
  return prismaClient.$queryRaw<WalkRow[]>`
    WITH RECURSIVE constructors(class_id, constructor_id) AS (
      SELECT d."fromSymbolId", d."toSymbolId"
      FROM "CodeEdge" d
      JOIN "CodeSymbol" c ON c.id = d."fromSymbolId" AND c.kind = 'CLASS'
      JOIN "CodeSymbol" k ON k.id = d."toSymbolId" AND k.kind = 'METHOD'
        AND k.name = ANY(${CONSTRUCTOR_NAMES}::text[])
      WHERE d."sourceId" = ${sourceId} AND d.type = 'DEFINES'
    ), pair(a, b) AS (
      SELECT class_id, constructor_id FROM constructors
      UNION ALL
      SELECT constructor_id, class_id FROM constructors
    ), walk(id, via, depth) AS (
      SELECT start, NULL::text, 0 FROM unnest(${starts}::text[]) AS start
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

/** The methods a class defines. */
export async function methodsOf(classId: string) {
  const edges = await prismaClient.codeEdge.findMany({
    where: { fromSymbolId: classId, type: 'DEFINES', to: { kind: 'METHOD' } },
    select: { toSymbolId: true },
  });
  return edges.flatMap((edge) => (edge.toSymbolId ? [edge.toSymbolId] : []));
}

/** Each constructor of the source, with the class that defines it. */
export async function constructorClasses(sourceId: string) {
  const edges = await prismaClient.codeEdge.findMany({
    where: {
      sourceId,
      type: 'DEFINES',
      from: { kind: 'CLASS' },
      to: { kind: 'METHOD', name: { in: CONSTRUCTOR_NAMES } },
    },
    select: { fromSymbolId: true, toSymbolId: true },
  });
  return new Map(
    edges.flatMap((edge) =>
      edge.toSymbolId ? [[edge.toSymbolId, edge.fromSymbolId] as const] : [],
    ),
  );
}

export type BusySymbol = GraphSymbol & { callers: number; calls: number };

/**
 * The symbols (files aside) with the most resolved calls in and out. A constructor's calls
 * count for its class, so the class stands for both.
 */
export async function busiestSymbols(sourceId: string, limit: number) {
  return prismaClient.$queryRaw<BusySymbol[]>`
    WITH constructors(class_id, constructor_id) AS (
      SELECT d."fromSymbolId", d."toSymbolId"
      FROM "CodeEdge" d
      JOIN "CodeSymbol" c ON c.id = d."fromSymbolId" AND c.kind = 'CLASS'
      JOIN "CodeSymbol" k ON k.id = d."toSymbolId" AND k.kind = 'METHOD'
        AND k.name = ANY(${CONSTRUCTOR_NAMES}::text[])
      WHERE d."sourceId" = ${sourceId} AND d.type = 'DEFINES'
    ), ends AS (
      SELECT "fromSymbolId" AS id, 1 AS calls, 0 AS callers FROM "CodeEdge"
      WHERE "sourceId" = ${sourceId} AND type = 'CALLS' AND "toSymbolId" IS NOT NULL
      UNION ALL
      SELECT "toSymbolId", 0, 1 FROM "CodeEdge"
      WHERE "sourceId" = ${sourceId} AND type = 'CALLS' AND "toSymbolId" IS NOT NULL
    ), degrees AS (
      SELECT coalesce(k.class_id, ends.id) AS id,
        sum(ends.callers)::int AS callers, sum(ends.calls)::int AS calls
      FROM ends
      LEFT JOIN constructors k ON k.constructor_id = ends.id
      GROUP BY 1
    )
    SELECT s.id, s.name, s."qualifiedName", s.kind::text AS kind, s."filePath", s."lineStart",
           s."lineEnd", s.signature, s.exported, s."chunkId", d.callers, d.calls
    FROM degrees d JOIN "CodeSymbol" s ON s.id = d.id
    WHERE s.kind <> 'FILE'
    ORDER BY d.callers + d.calls DESC, s."qualifiedName" COLLATE "C"
    LIMIT ${limit}
  `;
}

/** The files with the most symbols (files themselves not counted). */
export async function fileSymbolCounts(sourceId: string, limit: number) {
  return prismaClient.$queryRaw<{ path: string; symbols: number }[]>`
    SELECT "filePath" AS path, count(*)::int AS symbols
    FROM "CodeSymbol"
    WHERE "sourceId" = ${sourceId} AND kind <> 'FILE'
    GROUP BY "filePath"
    ORDER BY symbols DESC, "filePath" COLLATE "C"
    LIMIT ${limit}
  `;
}

/** Unresolved calls per file and first name of the callee (`nn` of `nn.Linear`). */
export async function unresolvedCallHeads(sourceId: string) {
  return prismaClient.$queryRaw<{ filePath: string; head: string; calls: number }[]>`
    SELECT "filePath", split_part("toName", '.', 1) AS head, count(*)::int AS calls
    FROM "CodeEdge"
    WHERE "sourceId" = ${sourceId} AND type = 'CALLS' AND "toSymbolId" IS NULL
    GROUP BY "filePath", head
  `;
}

/** The modules each file imports that aren't in the repository, as written. */
export async function externalImports(sourceId: string) {
  return prismaClient.$queryRaw<{ filePath: string; specifier: string }[]>`
    SELECT DISTINCT "filePath", "toName" AS specifier
    FROM "CodeEdge"
    WHERE "sourceId" = ${sourceId} AND type = 'IMPORTS' AND "toSymbolId" IS NULL
      AND "toName" NOT LIKE '.%'
  `;
}

/** The start of each file's text, where its imports are. */
export async function fileHeads(sourceId: string, paths: string[]) {
  if (paths.length === 0) return [];
  return prismaClient.$queryRaw<{ path: string; head: string }[]>`
    SELECT path, left(content, ${IMPORT_REGION_CHARS}::int) AS head
    FROM "SourceDocument"
    WHERE "sourceId" = ${sourceId} AND path = ANY(${paths}::text[])
  `;
}
