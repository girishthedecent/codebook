import { appConfig } from '../../config/app.config.js';
import { countLines } from '../ingestion/code/lines.js';
import { BadRequestError, NotFoundError } from '../../utils/errors/app.error.js';
import type { ListFilesQuery, SourceContentQuery } from './source.dto.js';
import { getSourceService } from './source.service.js';
import {
  findFile,
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

export async function listFilesService(userId: string, sourceId: string, query: ListFilesQuery) {
  await getSourceService(userId, sourceId);
  return listDocuments(sourceId, query);
}

export async function getContentService(
  userId: string,
  sourceId: string,
  query: SourceContentQuery,
) {
  const source = await getSourceService(userId, sourceId);

  if (query.path !== undefined) {
    // A book is one document of \f-joined pages; its "lines" would mean nothing. Repository
    // files and web pages (by their URL) are read by lines.
    if (source.type === 'PDF') {
      throw new BadRequestError(
        'Line ranges are only available for repository files and web pages',
      );
    }
    return fileLines(sourceId, query.path, query.lineStart ?? 1, query.lineEnd);
  }

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

/** Lines `from`…`to` of a file or page (1-based, inclusive), at most `maxLines` of them. */
async function fileLines(sourceId: string, path: string, from: number, to: number | undefined) {
  const file = await findFile(sourceId, path);
  if (!file) throw new NotFoundError('File not found');
  if (file.skippedReason) {
    throw new NotFoundError(`This file wasn't indexed (${file.skippedReason})`);
  }

  // Web pages store no line count.
  const lineCount = file.lineCount ?? countLines(file.content);
  if (from > Math.max(lineCount, 1)) {
    throw new NotFoundError(`The file has ${lineCount} lines`);
  }
  const last = Math.min(to ?? lineCount, lineCount, from + appConfig.sources.maxContentLines - 1);
  const lines = file.content
    .split('\n')
    .slice(from - 1, last)
    .map((text, i) => ({ n: from + i, text }));
  return {
    path: file.path,
    language: file.language,
    lineCount,
    lineStart: from,
    lineEnd: from + lines.length - 1,
    lines,
  };
}
