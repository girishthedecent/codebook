import prismaClient from '../../config/db.config.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { ListFilesQuery } from './source.dto.js';

// Reads of what ingestion stored for a source (documents, TOC). Callers check access first.

type DocumentRow = {
  id: string;
  path: string;
  language: string | null;
  sizeBytes: number;
  pageStart: number | null;
  pageEnd: number | null;
  lineCount: number | null;
  skippedReason: string | null;
  createdAt: Date;
};

/** A page of the source's documents in path order (skipped files included). */
export async function listDocuments(sourceId: string, { cursor, limit, prefix }: ListFilesQuery) {
  // Raw SQL for two reasons: byte order ("C"), where the database's locale would sort
  // ".env" after "CHANGELOG.md" and ignore case, and starts_with(), which has no wildcards
  // (Prisma's startsWith turns "_" and "%" in the prefix into LIKE wildcards).
  // Everything but the content, which can be megabytes.
  const rows = await prismaClient.$queryRaw<DocumentRow[]>`
    SELECT id, path, language, "sizeBytes", "pageStart", "pageEnd", "lineCount",
      "skippedReason", "createdAt"
    FROM "SourceDocument"
    WHERE "sourceId" = ${sourceId}
      ${cursor === undefined ? Prisma.empty : Prisma.sql`AND path COLLATE "C" > ${cursor}`}
      ${prefix === undefined ? Prisma.empty : Prisma.sql`AND starts_with(path, ${prefix})`}
    ORDER BY path COLLATE "C"
    -- One extra row tells us whether there is another page.
    LIMIT ${limit + 1}
  `;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? Buffer.from(last.path).toString('base64url') : null,
  };
}

export async function findFile(sourceId: string, path: string) {
  return prismaClient.sourceDocument.findUnique({
    where: { sourceId_path: { sourceId, path } },
    select: { path: true, language: true, content: true, lineCount: true, skippedReason: true },
  });
}

export async function listTocNodes(sourceId: string) {
  return prismaClient.tocNode.findMany({
    where: { sourceId },
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      parentId: true,
      title: true,
      number: true,
      level: true,
      pageStart: true,
      pageEnd: true,
    },
  });
}

/** Text of one physical page, or null when no document of the source has that page. */
export async function findPageText(sourceId: string, page: number) {
  // Pages are separated by \f (chr 12); split in Postgres so the whole book isn't loaded.
  const [row] = await prismaClient.$queryRaw<{ text: string }[]>`
    SELECT split_part(content, chr(12), ${page} - "pageStart" + 1) AS text
    FROM "SourceDocument"
    WHERE "sourceId" = ${sourceId} AND "pageStart" <= ${page} AND "pageEnd" >= ${page}
    LIMIT 1
  `;
  return row?.text ?? null;
}

/** A TOC node and its section's text (subsections included), or null. */
export async function findTocSection(sourceId: string, tocNodeId: string) {
  const node = await prismaClient.tocNode.findFirst({
    where: { id: tocNodeId, sourceId },
    select: {
      id: true,
      title: true,
      number: true,
      level: true,
      pageStart: true,
      pageEnd: true,
      charStart: true,
      charEnd: true,
      document: { select: { content: true } },
    },
  });
  if (!node) return null;
  // Offsets are JavaScript string indexes (UTF-16), so slice here: Postgres substr counts
  // code points and would drift after any emoji or math symbol.
  const { charStart, charEnd, document, ...tocNode } = node;
  return { ...tocNode, text: document.content.slice(charStart, charEnd) };
}
