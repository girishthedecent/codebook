import { NotFoundError } from '../../utils/errors/app.error.js';
import type { PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import type { SourceContentQuery } from './source.dto.js';
import { getSourceService } from './source.service.js';
import {
  findPageText,
  findTocSection,
  listDocuments,
  listTocNodes,
} from './sourceContent.repository.js';

// What ingestion stored for a source. While a resync runs these keep showing the previous
// index; the new one replaces it in a single transaction at the end.

type TocNode = Awaited<ReturnType<typeof listTocNodes>>[number];
export type TocTreeNode = Omit<TocNode, 'parentId'> & { children: TocTreeNode[] };

/** The source's table of contents as a tree; empty before its first ingest. */
export async function getTocService(userId: string, sourceId: string) {
  await getSourceService(userId, sourceId);
  const nodes = await listTocNodes(sourceId);

  const byId = new Map<string, TocTreeNode>();
  const roots: TocTreeNode[] = [];
  // Nodes come in reading order, so a parent is always seen before its children.
  for (const { parentId, ...node } of nodes) {
    const treeNode = { ...node, children: [] };
    byId.set(node.id, treeNode);
    const parent = parentId ? byId.get(parentId) : undefined;
    (parent ? parent.children : roots).push(treeNode);
  }
  return roots;
}

export async function listFilesService(userId: string, sourceId: string, page: PaginationQuery) {
  await getSourceService(userId, sourceId);
  return listDocuments(sourceId, page);
}

export async function getContentService(
  userId: string,
  sourceId: string,
  query: SourceContentQuery,
) {
  await getSourceService(userId, sourceId);

  if (query.page !== undefined) {
    const text = await findPageText(sourceId, query.page);
    if (text === null) throw new NotFoundError('Page not found');
    return { page: query.page, text };
  }

  const section = await findTocSection(sourceId, query.tocNodeId!);
  if (!section) throw new NotFoundError('Section not found');
  const { text, ...tocNode } = section;
  return { tocNode, text: text.replaceAll('\f', '\n') };
}
