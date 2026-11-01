import { useMemo, useState } from 'react';
import { ArrowSquareOut, CaretRight } from '@phosphor-icons/react';
import { flatItems } from '@/api/queries/keys';
import { useSourceFiles } from '@/api/queries/sources';
import type { Source } from '@/api/types';
import { cn } from '@/lib/cn';
import { markdownHeadings } from '@/features/viewer/headings';
import { usePageText } from '@/features/viewer/usePageText';
import { Button, Callout, EmptyState, SectionHeading, TextButton } from '@/ui';
import { ListSkeleton } from './ListSkeleton';
import { statsOf, originOf, plural, type SiteOrigin, type SiteStats } from './sourceInfo';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';

const d = strings.detail;
const OUTLINE_SHOWN = 40;

/**
 * What a website source holds: the outline of its page (or each page, after a crawl), and
 * how the site was read. Headings come from the text that was stored, so they match what
 * the viewer shows when one is opened.
 */
export function SitePages({ source }: { source: Source }) {
  const files = useSourceFiles(source.id);
  const pages = flatItems(files.data);

  if (files.isPending) return <ListSkeleton label="Loading the page" rows={5} />;
  if (files.isError && pages.length === 0)
    return <Callout error={files.error} onRetry={() => void files.refetch()} />;
  if (pages.length === 0) return <EmptyState>{d.noFiles}</EmptyState>;

  return (
    <div className="space-y-10">
      {pages.length === 1 ? (
        <section aria-labelledby="site-outline">
          <SectionHeading id="site-outline">{d.outline}</SectionHeading>
          <Outline sourceId={source.id} url={pages[0]!.path} />
        </section>
      ) : (
        <section aria-labelledby="site-pages">
          <SectionHeading id="site-pages">{d.pages}</SectionHeading>
          <ul className="space-y-1">
            {pages.map((page) => (
              <PageEntry key={page.id} sourceId={source.id} url={page.path} />
            ))}
          </ul>
          {files.hasNextPage && (
            <Button
              variant="ghost"
              className="mt-2"
              loading={files.isFetchingNextPage}
              onClick={() => void files.fetchNextPage()}
            >
              {strings.loadMore}
            </Button>
          )}
        </section>
      )}
      <CrawlNotes source={source} />
    </div>
  );
}

function PageEntry({ sourceId, url }: { sourceId: string; url: string }) {
  const [open, setOpen] = useState(false);
  const openInViewer = useOpenInViewer();
  return (
    <li>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} the outline of ${shortUrl(url)}`}
          onClick={() => setOpen(!open)}
        >
          <CaretRight
            size={12}
            aria-hidden
            className={cn('transition-transform duration-150', open && 'rotate-90')}
          />
        </Button>
        <button
          type="button"
          onClick={() => openInViewer({ kind: 'file', sourceId, path: url })}
          className="min-h-9 min-w-0 flex-1 truncate py-1 text-left text-sm text-ink hover:text-accent max-sm:min-h-11"
        >
          {shortUrl(url)}
        </button>
      </div>
      {open && (
        <div className="pb-3 pl-9">
          <Outline sourceId={sourceId} url={url} />
        </div>
      )}
    </li>
  );
}

function Outline({ sourceId, url }: { sourceId: string; url: string }) {
  const { text, error, retry } = usePageText(sourceId, url);
  const openInViewer = useOpenInViewer();
  const [all, setAll] = useState(false);
  const headings = useMemo(() => (text ? markdownHeadings(text) : []), [text]);

  if (error) return <Callout error={error} onRetry={retry} />;
  if (text === undefined) return <ListSkeleton label="Reading the outline" rows={5} />;
  if (headings.length === 0) return <EmptyState>{d.noOutline}</EmptyState>;

  const top = Math.min(...headings.map((h) => h.level));
  const shown = all ? headings : headings.slice(0, OUTLINE_SHOWN);
  return (
    <>
      <ul className="font-serif">
        {shown.map((h, i) => (
          <li key={i} style={{ paddingLeft: Math.min(h.level - top, 3) * 18 }}>
            <button
              type="button"
              onClick={() => openInViewer({ kind: 'file', sourceId, path: url, heading: h.text })}
              className={cn(
                'min-h-9 w-full py-1 text-left text-pretty hover:text-accent max-sm:min-h-11',
                h.level === top ? 'text-base font-semibold text-ink' : 'text-sm text-ink-2',
              )}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
      {headings.length > shown.length && (
        <TextButton className="mt-2 py-2 text-xs" onClick={() => setAll(true)}>
          Show all {headings.length}
        </TextButton>
      )}
    </>
  );
}

/** How the crawl was set up, and what it left out. */
function CrawlNotes({ source }: { source: Source }) {
  const { url, maxDepth = 0, maxPages = 1 } = originOf<SiteOrigin>(source);
  const { skippedPages = 0, robotsBlocked = 0 } = statsOf<SiteStats>(source);
  const notes = [
    maxDepth > 0 ? d.crawlMany(maxDepth, maxPages) : d.crawlOne,
    skippedPages > 0 ? d.notKept(skippedPages) : '',
    robotsBlocked > 0 ? d.robots(robotsBlocked) : '',
  ].filter(Boolean);

  return (
    <section aria-labelledby="site-crawl">
      <SectionHeading id="site-crawl">{d.crawl}</SectionHeading>
      <ul className="max-w-prose space-y-1.5 text-sm text-ink-2">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-sm text-accent underline underline-offset-2 hover:text-accent-2 max-sm:min-h-11"
        >
          {d.openOriginal}
          <ArrowSquareOut size={14} aria-hidden />
        </a>
      )}
      <p className="mt-1 text-xs text-ink-3">
        {plural(statsOf<SiteStats>(source).pages ?? 0, 'page')} indexed.
      </p>
    </section>
  );
}

/** "https://huggingface.co/docs/transformers/en/llm_tutorial/" becomes "huggingface.co/docs/transformers/en/llm_tutorial". */
function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '') + u.search;
  } catch {
    return url;
  }
}
