import { randomUUID } from 'node:crypto';
import { appConfig } from '../../../config/app.config.js';
import { sha256 } from '../../../utils/hash.js';
import type { WebsiteOrigin } from '../../sources/source.dto.js';
import { defaultWebsiteTitle } from '../../sources/source.service.js';
import { markdownHeadings } from '../code/markdown.chunker.js';
import { websiteIngestHash } from '../contentHash.js';
import { chunkDocument, chunkText } from '../doc.chunker.js';
import type { DraftDocument } from '../ingestion.types.js';
import { crawl, CrawlError } from '../web/crawler.js';
import { extractHtml, extractText } from '../web/extract.js';
import { cleanPageText, fencedBlocks } from '../web/pageText.js';
import type { AdapterContext, AdapterResult, IngestSource } from './adapter.js';

type Page = { url: string; text: string; sizeBytes: number };

/**
 * Crawls the website from its URL (robots.txt, same site, the source's depth and page
 * limits), keeps each page's readable text as markdown and chunks it by its headings.
 */
export async function prepareWebsite(
  source: IngestSource,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const fail = (error: string) => ({ outcome: 'failed', error }) as const;
  const origin = source.origin as WebsiteOrigin;
  const limits = { maxDepth: origin.maxDepth, maxPages: origin.maxPages };

  await ctx.stage('FETCHING', 2);
  const pages: Page[] = [];
  let startTitle: string | null | undefined;
  let emptyPages = 0;
  let crawled;
  try {
    crawled = await crawl(origin.url, limits, (page) => {
      const extracted =
        page.contentType === 'text/plain' || page.contentType === 'text/markdown'
          ? extractText(page.text)
          : extractHtml(page.text, page.url);
      // The first page is the start page.
      if (startTitle === undefined) startTitle = extracted.title;
      const text = cleanPageText(extracted.text);
      if (text) pages.push({ url: page.url, text, sizeBytes: page.sizeBytes });
      else emptyPages++;
      return extracted.links;
    });
  } catch (error) {
    if (error instanceof CrawlError) return fail(error.message);
    throw error;
  }
  if (pages.length === 0) return fail('No readable text was found on the page');

  // Still the title made from the URL: the start page's own title reads better.
  const title =
    startTitle && source.title === defaultWebsiteTitle(new URL(origin.url))
      ? startTitle
      : source.title;

  await ctx.stage('CHUNKING', 10);
  const hashed = pages.map((page) => ({ ...page, hash: sha256(page.text) }));
  const contentHash = websiteIngestHash(title, limits, hashed);
  if (ctx.unchanged(contentHash)) return { outcome: 'unchanged' };

  const documents: DraftDocument[] = hashed.map((page) => {
    const plan = chunkDocument(
      page.text,
      markdownHeadings(page.text),
      appConfig.ingestion.chunking,
      fencedBlocks(page.text),
    );
    // Web pages have no page numbers or lines; a citation is the URL and the heading.
    const unpaged = <T extends { pageStart: number | null; pageEnd: number | null }>(chunk: T) => ({
      ...chunk,
      pageStart: null,
      pageEnd: null,
    });
    return {
      id: randomUUID(),
      path: page.url,
      language: 'markdown',
      content: page.text,
      pageStart: null,
      pageEnd: null,
      lineCount: null,
      sizeBytes: page.sizeBytes,
      skippedReason: null,
      hash: page.hash,
      toc: [],
      parents: plan.parents.map((parent) => ({
        ...unpaged(parent),
        id: randomUUID(),
        hash: sha256(chunkText(page.text, parent.start, parent.end)),
      })),
      children: plan.children.map((child) => ({
        ...unpaged(child),
        id: randomUUID(),
        hash: sha256(chunkText(page.text, child.start, child.end)),
      })),
    };
  });

  const children = documents.reduce((sum, doc) => sum + doc.children.length, 0);
  const { maxChildChunks } = appConfig.ingestion.repo;
  if (children > maxChildChunks) {
    return fail(
      `This website needs ${children.toLocaleString('en-US')} search chunks; the limit is ` +
        `${maxChildChunks.toLocaleString('en-US')}. Lower the page or depth limit.`,
    );
  }

  return {
    outcome: 'draft',
    contentHash,
    documents,
    title,
    website: {
      pages: documents.length,
      skippedPages: crawled.skippedPages + emptyPages,
      robotsBlocked: crawled.robotsBlocked,
    },
  };
}
