import robotsParserModule from 'robots-parser';
import { appConfig } from '../../../config/app.config.js';
import { createPacer } from '../../../utils/pacer.js';
import { FetchError, safeFetch, UrlRefusedError, USER_AGENT } from '../../../utils/httpFetch.js';
import { decodeBody } from './pageText.js';

export type CrawledPage = {
  // Normalized, after redirects.
  url: string;
  contentType: string;
  text: string;
  sizeBytes: number;
};

export type CrawlLimits = { maxDepth: number; maxPages: number };

export type CrawlResult = { skippedPages: number; robotsBlocked: number };

/** The start page can't be crawled; the message is safe to show the user. */
export class CrawlError extends Error {}

const PAGE_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown'];
// Links to these are files, not pages; skipped without a request.
const FILE_EXTENSIONS =
  /\.(pdf|png|jpe?g|gif|webp|svg|ico|bmp|zip|gz|tgz|tar|rar|7z|exe|dmg|msi|mp[34]|mov|avi|webm|woff2?|ttf|eot|css|js|json|xml|rss|atom|wasm)$/i;
const TRACKING_PARAMS = /^(utm_.*|gclid|fbclid|mc_cid|mc_eid|ref_src)$/i;

// The package's types describe an ES default export; at runtime the CommonJS module is the function.
const robotsParser = robotsParserModule as unknown as typeof robotsParserModule.default;

type Robots = { isAllowed(url: string): boolean; delayMs: number };

/**
 * Crawls a site breadth-first from `start`: same origin as the start page (after its
 * redirects), up to `maxDepth` links away and `maxPages` pages, one request at a time,
 * obeying robots.txt. `onPage` gets each page and returns the links found on it.
 */
export async function crawl(
  start: string,
  limits: CrawlLimits,
  onPage: (page: CrawledPage) => string[],
): Promise<CrawlResult> {
  const { requestGapMs, crawlBudgetMs } = appConfig.ingestion.website;
  const deadline = Date.now() + crawlBudgetMs;
  const robotsByOrigin = new Map<string, Robots>();
  let pace = createPacer(requestGapMs);
  const robotsFor = async (url: string) => {
    const origin = new URL(url).origin;
    let robots = robotsByOrigin.get(origin);
    if (!robots) {
      await pace();
      robots = await fetchRobots(origin);
      robotsByOrigin.set(origin, robots);
      // Crawl-delay only ever slows us down.
      if (robots.delayMs > requestGapMs) pace = createPacer(robots.delayMs);
    }
    return robots;
  };

  const startUrl = normalizeUrl(start);
  if (!startUrl) throw new CrawlError('The start URL is not a valid http(s) URL');
  if (!(await robotsFor(startUrl)).isAllowed(startUrl)) {
    throw new CrawlError("The site's robots.txt doesn't allow fetching this page");
  }

  await pace();
  let first;
  try {
    first = await fetchPage(startUrl);
  } catch (error) {
    if (error instanceof FetchError) throw new CrawlError(error.message);
    throw error;
  }
  if (!first.ok) throw new CrawlError(`The page answered with HTTP ${first.status}`);
  const origin = new URL(first.page.url).origin;
  // Redirected to another site: its own robots.txt has a say too.
  if (!(await robotsFor(first.page.url)).isAllowed(first.page.url)) {
    throw new CrawlError("The site's robots.txt doesn't allow fetching this page");
  }

  const seen = new Set([startUrl, first.page.url]);
  let kept = 1;
  let skippedPages = 0;
  let robotsBlocked = 0;
  const queue: { url: string; depth: number }[] = [];
  // Only maxPages can ever be fetched; a few times that covers pages that get skipped,
  // without holding every link of a link-farm page in memory.
  const maxQueued = limits.maxPages * 4;
  const enqueue = (links: string[], depth: number) => {
    if (depth > limits.maxDepth) return;
    for (const link of links) {
      if (queue.length + kept >= maxQueued) return;
      const url = normalizeUrl(link);
      if (!url || seen.has(url) || new URL(url).origin !== origin) continue;
      if (FILE_EXTENSIONS.test(new URL(url).pathname)) continue;
      seen.add(url);
      queue.push({ url, depth });
    }
  };
  enqueue(onPage(first.page), 1);

  while (queue.length > 0 && kept < limits.maxPages) {
    if (Date.now() > deadline) {
      skippedPages += queue.length;
      break;
    }
    const { url, depth } = queue.shift()!;
    if (!(await robotsFor(url)).isAllowed(url)) {
      robotsBlocked++;
      continue;
    }
    await pace();
    try {
      const fetched = await fetchPage(url);
      const final = fetched.ok ? fetched.page.url : url;
      // A redirect off the site, or to a page already crawled.
      if (!fetched.ok || new URL(final).origin !== origin || (final !== url && seen.has(final))) {
        skippedPages++;
        continue;
      }
      // A redirect inside the site needs the target allowed too.
      if (final !== url && !(await robotsFor(final)).isAllowed(final)) {
        robotsBlocked++;
        continue;
      }
      seen.add(final);
      kept++;
      enqueue(onPage(fetched.page), depth + 1);
    } catch (error) {
      if (!(error instanceof FetchError)) throw error;
      skippedPages++;
    }
  }
  return { skippedPages, robotsBlocked };
}

async function fetchPage(url: string) {
  const { pageTimeoutMs, maxPageBytes } = appConfig.ingestion.website;
  const res = await safeFetch(url, {
    timeoutMs: pageTimeoutMs,
    maxBytes: maxPageBytes,
    allowedContentTypes: PAGE_TYPES,
    accept: 'text/html,application/xhtml+xml,text/markdown,text/plain;q=0.9',
  });
  if (res.status < 200 || res.status >= 300) return { ok: false as const, status: res.status };
  const page: CrawledPage = {
    url: normalizeUrl(res.url) ?? res.url,
    contentType: res.contentType,
    text: decode(res.body, res.charset),
    sizeBytes: res.body.length,
  };
  return { ok: true as const, page };
}

// robots.txt rules for an origin: missing (4xx, or not text) allows everything; an error,
// a 5xx or a 429 disallows everything, as search engines treat it.
async function fetchRobots(origin: string): Promise<Robots> {
  const url = `${origin}/robots.txt`;
  const allowAll = { isAllowed: () => true, delayMs: 0 };
  const denyAll = { isAllowed: () => false, delayMs: 0 };
  let res;
  try {
    res = await safeFetch(url, {
      timeoutMs: appConfig.ingestion.website.pageTimeoutMs,
      maxBytes: 500 * 1024,
    });
  } catch (error) {
    // The site itself can't be fetched: say why, rather than blaming robots.txt.
    if (error instanceof UrlRefusedError) throw new CrawlError(error.message);
    return denyAll;
  }
  if (res.status === 429 || res.status >= 500) return denyAll;
  if (res.status >= 400) return allowAll;
  if (res.status < 200 || res.status >= 300) return denyAll;
  if (res.contentType && !res.contentType.startsWith('text/')) return allowAll;

  const robots = robotsParser(url, decode(res.body, res.charset));
  const delay = robots.getCrawlDelay(USER_AGENT) ?? 0;
  return {
    isAllowed: (page) => robots.isAllowed(page, USER_AGENT) !== false,
    delayMs: Math.min(delay * 1000, appConfig.ingestion.website.maxCrawlDelayMs),
  };
}

/**
 * The form URLs are compared and stored in: no fragment, tracking parameters dropped, the
 * rest of the query sorted. Null for anything but http(s).
 */
export function normalizeUrl(raw: string) {
  const url = URL.parse(raw);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  url.hash = '';
  const params = [...url.searchParams].filter(([name]) => !TRACKING_PARAMS.test(name));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = new URLSearchParams(params).toString();
  return url.href;
}

function decode(body: Buffer, charset: string | null) {
  return decodeBody(body, charset);
}
