import prismaClient from '../../config/db.config.js';
import { paginate, type PaginationQuery } from '../../utils/helpers/pagination.helpers.js';

// Reads of what ingestion stored for a source (documents, TOC). Callers check access first.

export async function listDocuments(sourceId: string, page: PaginationQuery) {
  return paginate(
    (query) =>
      prismaClient.sourceDocument.findMany({
        ...query,
        where: { AND: [query.where, { sourceId }] },
        // Everything but the content, which can be megabytes.
        select: {
          id: true,
          path: true,
          language: true,
          sizeBytes: true,
          pageStart: true,
          pageEnd: true,
          lineCount: true,
          skippedReason: true,
          createdAt: true,
        },
      }),
    page,
  );
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
