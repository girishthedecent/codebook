import prismaClient from '../../../config/db.config.js';
import { Prisma } from '../../../generated/prisma/client.js';

export type CodeMatch = { sourceId: string; sourceTitle: string; path: string; line: number };

type CodeSearch = {
  workspaceId: string;
  pattern: string;
  regex: boolean;
  sourceId?: string;
  pathPrefix?: string;
  limit: number;
  timeoutMs: number;
};

/**
 * Lines of the workspace's repository files that match, in path and line order. A regex
 * runs in Postgres, never in this process, under a statement timeout: a pattern that
 * backtracks for ever only costs one query, not the event loop.
 */
export async function searchCodeLines(search: CodeSearch): Promise<CodeMatch[]> {
  const { workspaceId, pattern, regex, sourceId, pathPrefix, limit, timeoutMs } = search;
  const like = `%${pattern.replace(/[\\%_]/g, '\\$&')}%`;
  const matches = regex ? Prisma.sql`~* ${pattern}` : Prisma.sql`ILIKE ${like}`;

  return prismaClient.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`;
    return tx.$queryRaw<CodeMatch[]>`
      SELECT s.id AS "sourceId", s.title AS "sourceTitle", d.path, l.n::int AS line
      FROM "SourceDocument" d
      JOIN "Source" s ON s.id = d."sourceId",
      LATERAL regexp_split_to_table(d.content, E'\\n') WITH ORDINALITY AS l(text, n)
      WHERE s."workspaceId" = ${workspaceId} AND s.type = 'GITHUB_REPO'
        AND d."skippedReason" IS NULL
        ${sourceId ? Prisma.sql`AND s.id = ${sourceId}` : Prisma.empty}
        ${pathPrefix ? Prisma.sql`AND starts_with(d.path, ${pathPrefix})` : Prisma.empty}
        AND d.content ${matches}
        AND l.text ${matches}
      ORDER BY d.path COLLATE "C", l.n
      LIMIT ${limit}
    `;
  });
}

/** The lines of each file, for the matches' surrounding context. */
export async function fileContents(sourceId: string, paths: string[]) {
  const rows = await prismaClient.sourceDocument.findMany({
    where: { sourceId, path: { in: paths } },
    select: { path: true, content: true },
  });
  return new Map(rows.map((row) => [row.path, row.content.split('\n')]));
}
