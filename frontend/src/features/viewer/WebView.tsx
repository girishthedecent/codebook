import { useEffect, useMemo, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { sourceContentQueryOptions } from '@/api/queries';
import { ProgressRule } from '@/ui';
import { ViewError } from './ViewError';
import { s } from './strings';

const WINDOW = 400;
// Web pages are short; past this many lines the rest stays unloaded.
const MAX_WINDOWS = 10;

type Props = { sourceId: string; url: string; heading?: string };

type Heading = { level: number; text: string };

/** A web page as stored at ingest: its text with headings, scrolled to the cited section. */
export function WebView({ sourceId, url, heading }: Props) {
  const firstQuery = useQueries({
    queries: [sourceContentQueryOptions(sourceId, { path: url, lineStart: 1, lineEnd: WINDOW })],
  })[0]!;
  const lineCount =
    firstQuery.data && 'lines' in firstQuery.data ? firstQuery.data.lineCount : undefined;
  const windowCount = Math.min(MAX_WINDOWS, Math.ceil((lineCount ?? 1) / WINDOW));

  const results = useQueries({
    queries: Array.from({ length: windowCount }, (_, w) =>
      sourceContentQueryOptions(sourceId, {
        path: url,
        lineStart: w * WINDOW + 1,
        lineEnd: (w + 1) * WINDOW,
      }),
    ),
  });

  const loaded = results.every((r) => r.data);
  const text = loaded
    ? results
        .flatMap((r) => (r.data && 'lines' in r.data ? r.data.lines.map((l) => l.text) : []))
        .join('\n')
    : undefined;

  const trail = useMemo(() => (text ? headingTrail(text, heading) : []), [text, heading]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!text || !heading) return;
    const wanted = squash(heading);
    const el = [...(bodyRef.current?.querySelectorAll<HTMLElement>('h1,h2,h3,h4') ?? [])].find(
      (h) => squash(h.textContent ?? '') === wanted,
    );
    el?.scrollIntoView({ block: 'start' });
    el?.classList.add('bg-highlight');
  }, [text, heading]);

  const error = results.find((r) => r.isError) ?? (firstQuery.isError ? firstQuery : undefined);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-3 border-b border-rule px-3 py-1.5">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">
          {trail.length ? trail.map((h) => h.text).join(' › ') : hostAndPath(url)}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-accent underline underline-offset-2"
        >
          {s.openPage}
          <ArrowSquareOut size={12} aria-hidden />
        </a>
      </div>
      {!loaded && !error && <ProgressRule label={s.loading} />}
      {error ? (
        <ViewError error={error.error} onRetry={() => error.refetch()} />
      ) : (
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto px-5 py-5">
          {text !== undefined && (
            <div className="prose max-w-[64ch] [&_h1]:scroll-mt-4 [&_h2]:scroll-mt-4 [&_h3]:scroll-mt-4 [&_h4]:scroll-mt-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {text}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Stored pages carry no images; never fetch one from a crawled page.
  img: ({ alt }) => <span>{alt}</span>,
};

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** The chain of headings leading to `heading`: "Guide › Routing › Route paths". */
function headingTrail(text: string, heading: string | undefined): Heading[] {
  if (!heading) return [];
  const wanted = squash(heading);
  const stack: Heading[] = [];
  for (const line of text.split('\n')) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    const h = { level: m[1]!.length, text: m[2]!.trim() };
    while (stack.length && stack[stack.length - 1]!.level >= h.level) stack.pop();
    stack.push(h);
    if (squash(h.text) === wanted) return [...stack];
  }
  return [];
}

function hostAndPath(url: string) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}
