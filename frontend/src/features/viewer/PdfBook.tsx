import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isTyping } from '@/lib/keyboard';
import { Button, Callout, ProgressRule } from '@/ui';
import { pageLabelsOptions } from './pageLabels';
import { pdfDocumentOptions, readAsText } from './pdf';
import { PdfPage } from './PdfPage';
import { PageBar, zooms, type Zoom } from './PageBar';
import { useTextMarks } from './useTextMarks';
import { useViewerContext } from './viewerContext';
import { ViewError } from './ViewError';
import type { BookViewProps } from './BookView';
import { s } from './strings';

type Props = BookViewProps & { onUnavailable: () => void };

const ZOOM_STEPS = zooms.map((z) => z.value);
const ZOOM_KEY = 'codebook-pdf-zoom';

// The reader's last zoom, so a book opens the way they left the last one.
function savedZoom(): Zoom {
  try {
    const saved = localStorage.getItem(ZOOM_KEY);
    return ZOOM_STEPS.find((z) => String(z) === saved) ?? 'fit';
  } catch {
    return 'fit';
  }
}

/** The real page from the original PDF. Says so when the file can't be had, so the text shows. */
export default function PdfBook({ sourceId, page, snippet, onPage, onUnavailable }: Props) {
  const pdf = useQuery(pdfDocumentOptions(sourceId));
  // Read by the header, which shows the printed number beside the physical one.
  useQuery({ ...pageLabelsOptions(sourceId, pdf.data), enabled: Boolean(pdf.data) });
  const [zoom, setZoomState] = useState<Zoom>(savedZoom);
  const setZoom = (next: Zoom) => {
    setZoomState(next);
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Private windows may refuse storage; the zoom still applies to this book.
    }
  };
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // The skeleton stands in until the first page has been drawn; after that the page being
  // left stays on screen until the next one is ready.
  const [drawn, setDrawn] = useState(false);
  const [text, setText] = useState<{ layer: HTMLElement; version: number }>();
  const onRendered = useCallback((layer: HTMLElement) => {
    setDrawn(true);
    setText((prev) => ({ layer, version: (prev?.version ?? 0) + 1 }));
  }, []);

  const { highlights } = useViewerContext();
  const passages = highlights.filter((h) => h.page === page).map((h) => h.text);
  useTextMarks(text?.layer ?? null, text?.version, passages);

  // "Fit page" needs the height the page can take: the scroller's, inside its padding.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setHeight(Math.floor(entry!.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fallback = pdf.isError && readAsText(pdf.error);
  useEffect(() => {
    if (fallback) onUnavailable();
  }, [fallback, onUnavailable]);

  // A new page starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0, left: 0 });
  }, [page, sourceId]);

  const pageCount = pdf.data?.numPages;
  const outOfRange = pageCount !== undefined && page > pageCount;
  const go = (next: number) => {
    const clamped = Math.max(1, pageCount ? Math.min(pageCount, next) : next);
    if (clamped !== page) onPage(clamped);
  };

  // Turning pages and zooming from the keyboard, unless the reader is typing somewhere.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTyping(event.target) || inOtherControl(event.target)) return;
    // Keys pressed in the conversation or anywhere else on the page are theirs. The viewer's
    // own frame takes focus when the reader clicks the page, so it counts as the book.
    const inBook = event.target instanceof Node && root.current?.contains(event.target);
    const onFrame = event.target instanceof Element && event.target.matches('[data-viewer]');
    if (event.target !== document.body && !inBook && !onFrame) return;
    const el = scroller.current;
    const pans = el !== null && el.scrollWidth > el.clientWidth;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        // A zoomed page wider than the pane keeps the arrows for panning.
        if (pans) return;
        go(page + (event.key === 'ArrowRight' ? 1 : -1));
        break;
      case 'PageUp':
      case 'PageDown':
        go(page + (event.key === 'PageDown' ? 1 : -1));
        break;
      case '+':
      case '=':
      case '-': {
        const at = ZOOM_STEPS.indexOf(zoom);
        const next = ZOOM_STEPS[at + (event.key === '-' ? -1 : 1)];
        if (next !== undefined) setZoom(next);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col">
      <PageBar page={page} pageCount={pageCount} onGo={go} zoom={zoom} onZoom={setZoom} />
      {pdf.isPending && <ProgressRule label={s.loading} />}
      <div
        ref={scroller}
        data-vaul-no-drag
        className="min-h-0 flex-1 overflow-auto bg-paper-2 p-3 [touch-action:pan-x_pan-y_pinch-zoom] sm:p-4"
      >
        {pdf.isError && !fallback && (
          <ViewError message={s.fileFailed} onRetry={() => void pdf.refetch()} />
        )}
        {outOfRange && (
          <Callout
            className="mx-auto max-w-prose"
            action={
              <Button size="sm" onClick={() => go(pageCount)}>
                {s.toLastPage(pageCount)}
              </Button>
            }
          >
            {s.pageCount(pageCount)}
          </Callout>
        )}
        {!drawn && !pdf.isError && !outOfRange && <PageSkeleton />}
        {pdf.data && !outOfRange && (
          // Measured and drawn while hidden, so the skeleton is replaced in one step.
          <div className={drawn ? undefined : 'invisible h-0'}>
            <PdfPage
              doc={pdf.data}
              page={page}
              zoom={zoom}
              snippet={snippet}
              fitHeight={zoom === 'page' ? height : undefined}
              onRendered={onRendered}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Menus, sliders, tab lists, trees and grids keep the arrow keys for themselves. */
function inOtherControl(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(
      '[role="menu"], [role="listbox"], [role="slider"], [role="tablist"], [role="tree"], [role="radiogroup"], [role="grid"], [role="toolbar"]',
    ) !== null
  );
}

/** A blank page in the shape of a sheet of paper, where the page will appear. */
function PageSkeleton() {
  return (
    <div
      role="status"
      aria-label={s.loading}
      className="mx-auto w-full max-w-[794px] animate-pulse bg-paper px-[12%] py-[10%] shadow-[0_0_0_1px_var(--rule)] motion-reduce:animate-none"
      style={{ aspectRatio: '1 / 1.414' }}
    >
      <div className="mx-auto mb-8 h-4 w-2/5 rounded-xs bg-paper-3" />
      {Array.from({ length: 14 }, (_, i) => (
        <div
          key={i}
          className="mb-3 h-2.5 rounded-xs bg-paper-3"
          style={{ width: i % 5 === 4 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}
