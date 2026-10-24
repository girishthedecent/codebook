import { randomUUID } from 'node:crypto';
import { sha256 } from '../../../utils/hash.js';
import { getObjectBuffer } from '../../../utils/storage.js';
import type { PdfOrigin } from '../../sources/source.dto.js';
import { ingestHash } from '../contentHash.js';
import { chunkDocument, chunkText } from '../doc.chunker.js';
import type { DraftDocument } from '../ingestion.types.js';
import { readPdf, PdfReadError } from '../pdf/pdf.parser.js';
import { cleanPages, hasTextLayer } from '../pdf/pdf.text.js';
import { buildToc, outlineHeadings } from '../toc.js';
import type { AdapterContext, AdapterResult, IngestSource } from './adapter.js';

/** Downloads and parses the uploaded PDF, then builds its TOC and chunk plan. */
export async function preparePdf(
  source: IngestSource,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const fail = (error: string) => ({ outcome: 'failed', error }) as const;
  const origin = source.origin as PdfOrigin;
  if (!origin.storageKey) {
    return fail("The PDF upload didn't finish. Delete this source and upload it again.");
  }
  await ctx.stage('FETCHING', 2);
  const file = await getObjectBuffer(origin.storageKey);
  if (!file) return fail('The uploaded file is missing. Delete this source and upload it again.');

  await ctx.stage('PARSING', 5);
  let raw;
  try {
    raw = await readPdf(file);
  } catch (error) {
    if (error instanceof PdfReadError) return fail(error.message);
    throw error;
  }
  if (!hasTextLayer(raw.pages)) {
    return fail("This PDF has no text layer (scanned pages need OCR, which isn't supported)");
  }

  await ctx.stage('STRUCTURING', 8);
  const headings = outlineHeadings(raw.outline);
  const pages = cleanPages(raw.pages, headings);
  const toc = buildToc(pages, headings);

  await ctx.stage('CHUNKING', 10);
  const content = pages.join('\f');
  const contentHash = ingestHash(source.title, [content]);
  if (ctx.unchanged(contentHash)) return { outcome: 'unchanged' };

  const plan = chunkDocument(content, toc);
  const document: DraftDocument = {
    id: randomUUID(),
    path: origin.fileName,
    language: null,
    content,
    pageStart: 1,
    pageEnd: pages.length,
    lineCount: null,
    sizeBytes: Buffer.byteLength(content),
    skippedReason: null,
    hash: sha256(content),
    toc: toc.map((entry) => ({ ...entry, id: randomUUID() })),
    parents: plan.parents.map((parent) => ({
      ...parent,
      id: randomUUID(),
      hash: sha256(chunkText(content, parent.start, parent.end)),
    })),
    children: plan.children.map((child) => ({
      ...child,
      id: randomUUID(),
      hash: sha256(chunkText(content, child.start, child.end)),
    })),
  };
  return { outcome: 'draft', contentHash, documents: [document] };
}
