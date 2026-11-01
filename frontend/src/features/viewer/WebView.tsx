import { useEffect, useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { ProgressRule, textLinkClass } from '@/ui';
import { findSnippet } from './findSnippet';
import { markdownHeadings, squash, type Heading } from './headings';
import { usePageText } from './usePageText';
import { ViewError } from './ViewError';
import { s } from './strings';

type Props = { sourceId: string; url: string; heading?: string; snippet?: string };

const HIGHLIGHT = 'cb-cited';

/**
 * A web page as stored at ingest: its text with headings, scrolled to the cited section,
 * with the cited passage itself marked when it can be found in the text.
 */
export function WebView({ sourceId, url, heading, snippet }: Props) {
  const { text, loaded, error, retry } = usePageText(sourceId, url);
  const trail = useMemo(() => (text ? headingTrail(text, heading) : []), [text, heading]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!text || !body) return;
    const range = snippet ? rangeOfSnippet(body, snippet) : undefined;
    if (range) {
      markRange(range);
      range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
      return () => clearMark();
    }
    if (!heading) return;
    const wanted = squash(heading);
    const el = [...body.querySelectorAll<HTMLElement>('h1,h2,h3,h4')].find(
      (h) => squash(h.textContent ?? '') === wanted,
    );
    el?.scrollIntoView({ block: 'start' });
    el?.classList.add('bg-highlight');
    return () => el?.classList.remove('bg-highlight');
  }, [text, heading, snippet]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-3 border-b border-rule px-3 py-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-ink-3">
          {trail.length ? trail.map((h) => h.text).join(' › ') : hostAndPath(url)}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(textLinkClass, 'inline-flex shrink-0 items-center gap-1 text-xs')}
        >
          {s.openPage}
          <ArrowSquareOut size={12} aria-hidden />
        </a>
      </div>
      {!loaded && !error && <ProgressRule label={s.loading} />}
      {error ? (
        <ViewError error={error} onRetry={retry} />
      ) : (
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto px-5 py-5">
          {text !== undefined && (
            <div className="prose [&_h1]:scroll-mt-4 [&_h2]:scroll-mt-4 [&_h3]:scroll-mt-4 [&_h4]:scroll-mt-4">
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

/** The chain of headings leading to `heading`: "Guide › Routing › Route paths". */
function headingTrail(text: string, heading: string | undefined): Heading[] {
  if (!heading) return [];
  const wanted = squash(heading);
  const stack: Heading[] = [];
  for (const h of markdownHeadings(text)) {
    while (stack.length && stack[stack.length - 1]!.level >= h.level) stack.pop();
    stack.push(h);
    if (squash(h.text) === wanted) return [...stack];
  }
  return [];
}

/** The cited passage as a DOM range over the rendered text, or nothing if it isn't found. */
function rangeOfSnippet(root: HTMLElement, snippet: string): Range | undefined {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let all = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(all.length);
    all += (n as Text).data + ' ';
  }
  const found = findSnippet(all, snippet);
  if (!found) return undefined;

  const at = (offset: number) => {
    let i = starts.findLastIndex((start) => start <= offset);
    if (i < 0) i = 0;
    return { node: nodes[i]!, offset: Math.min(offset - starts[i]!, nodes[i]!.length) };
  };
  const from = at(found.start);
  const to = at(found.end - 1);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, Math.min(to.offset + 1, to.node.length));
  return range;
}

// The CSS Custom Highlight API marks the text without touching the nodes React renders.
// Browsers without it keep the heading highlight alone.
function markRange(range: Range) {
  if (typeof Highlight === 'undefined' || !('highlights' in CSS)) return;
  CSS.highlights.set(HIGHLIGHT, new Highlight(range));
}

function clearMark() {
  if ('highlights' in CSS) CSS.highlights.delete(HIGHLIGHT);
}

function hostAndPath(url: string) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}
