import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { ProgressRule, textLinkClass } from '@/ui';
import { findSnippet } from './findSnippet';
import { markdownHeadings, squash, type Heading } from './headings';
import { indexText, paint, unpaint } from './textIndex';
import { usePageText } from './usePageText';
import { useTextMarks } from './useTextMarks';
import { useViewerContext } from './viewerContext';
import { ViewError } from './ViewError';
import { s } from './strings';

type Props = { sourceId: string; url: string; heading?: string; snippet?: string };

type TextSize = 's' | 'm' | 'l';
const SIZE_KEY = 'codebook-web-text-size';
const sizes: Array<{ value: TextSize; label: string; glyph: string }> = [
  { value: 's', label: s.textSmall, glyph: 'text-xs' },
  { value: 'm', label: s.textMedium, glyph: 'text-sm' },
  { value: 'l', label: s.textLarge, glyph: 'text-base' },
];

function savedSize(): TextSize {
  try {
    const saved = localStorage.getItem(SIZE_KEY);
    return saved === 's' || saved === 'l' ? saved : 'm';
  } catch {
    return 'm';
  }
}

/**
 * A web page as stored at ingest: its text with headings, scrolled to the cited section,
 * with the cited passage itself marked when it can be found in the text.
 */
export function WebView({ sourceId, url, heading, snippet }: Props) {
  const { text, loaded, error, retry } = usePageText(sourceId, url);
  const trail = useMemo(() => (text ? headingTrail(text, heading) : []), [text, heading]);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [size, setSizeState] = useState<TextSize>(savedSize);
  const setSize = (next: TextSize) => {
    setSizeState(next);
    try {
      localStorage.setItem(SIZE_KEY, next);
    } catch {
      // Without storage the size holds until the viewer closes.
    }
  };

  const { highlights } = useViewerContext();
  const passages = highlights.filter((h) => h.path === url).map((h) => h.text);
  useTextMarks(body, text, passages);

  useEffect(() => {
    if (!text || !body) return;
    const range = snippet ? rangeOfSnippet(body, snippet) : undefined;
    if (range) {
      paint('cb-cited', [range]);
      range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
      return () => unpaint('cb-cited');
    }
    if (!heading) return;
    const wanted = squash(heading);
    const el = [...body.querySelectorAll<HTMLElement>('h1,h2,h3,h4')].find(
      (h) => squash(h.textContent ?? '') === wanted,
    );
    el?.scrollIntoView({ block: 'start' });
    el?.classList.add('bg-highlight');
    return () => el?.classList.remove('bg-highlight');
  }, [text, body, heading, snippet]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-3 border-b border-rule px-3 py-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-ink-3">
          {trail.length ? trail.map((h) => h.text).join(' › ') : hostAndPath(url)}
        </p>
        <div role="group" aria-label={s.textSize} className="flex shrink-0 items-center">
          {sizes.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={option.label}
              title={option.label}
              aria-pressed={size === option.value}
              onClick={() => setSize(option.value)}
              className={cn(
                'flex h-8 w-7 items-center justify-center rounded-xs font-serif hover:bg-paper-2 max-sm:h-11 max-sm:w-10',
                option.glyph,
                size === option.value ? 'text-ink' : 'text-ink-3',
              )}
            >
              <span aria-hidden>A</span>
            </button>
          ))}
        </div>
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
        <div
          ref={setBody}
          data-size={size === 'm' ? undefined : size}
          className="cb-web min-h-0 flex-1 overflow-auto px-5 py-5"
        >
          {text !== undefined && (
            <div
              data-selectable
              className="prose [&_h1]:scroll-mt-4 [&_h2]:scroll-mt-4 [&_h3]:scroll-mt-4 [&_h4]:scroll-mt-4"
            >
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

/** The chain of headings leading to `heading`: "Text generation › Decoding strategies". */
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
  const index = indexText(root);
  const found = findSnippet(index.text, snippet);
  return found && index.toRange(found);
}

function hostAndPath(url: string) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}
