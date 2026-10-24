import logger from '../../config/logger.config.js';
import { isCodeLanguage } from '../ingestion/code/treeSitter.js';
import type { DraftDocument } from '../ingestion/ingestion.types.js';
import { extractFile } from './extract/fileFacts.js';
import { resolveGraph, type GraphFile } from './resolve.js';

/** The code graph of a repository's TypeScript, JavaScript and Python files. */
export async function buildCodeGraph(documents: DraftDocument[]) {
  const files: GraphFile[] = [];
  for (const doc of documents) {
    if (doc.skippedReason || !isCodeLanguage(doc.language)) continue;
    let facts;
    try {
      facts = await extractFile(doc.content, doc.language, doc.path, doc.lineCount ?? 1);
    } catch (error) {
      // Syntax the extractor doesn't expect costs that file's graph, not the whole ingest.
      logger.warn('Code graph skipped a file', { path: doc.path, error: String(error) });
      continue;
    }
    if (!facts) continue;
    files.push({
      ...facts,
      documentId: doc.id,
      chunks: doc.children.map((child) => ({
        id: child.id,
        lineStart: child.lineStart,
        lineEnd: child.lineEnd,
        symbolName: child.symbolName,
      })),
    });
  }
  return resolveGraph(files);
}
