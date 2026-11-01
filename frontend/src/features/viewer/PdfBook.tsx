import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isTyping } from '@/lib/keyboard';
import { Button, Callout, ProgressRule } from '@/ui';
import { pageLabelsOptions } from './pageLabels';
import { pdfDocumentOptions, readAsText } from './pdf';
import { PdfPage } from './PdfPage';
import { PageBar, type Zoom } from './PageBar';
import { ViewError } from './ViewError';
import type { BookViewProps } from './BookView';
import { s } from './strings';

type Props = BookViewProps & { onUnavailable: () => void };

const ZOOM_STEPS: Zoom[] = ['fit', 1, 1.5];

/** The real page from the original PDF. Says so when the file can't be had, so the text shows. */
export default function PdfBook({ sourceId, page, snippet, onPage, onUnavailable }: Props) {
  const pdf = useQuery(pdfDocumentOptions(sourceId));
  // Read by the header, which shows the printed number beside the physical one.
  useQuery({ ...pageLabelsOptions(sourceId, pdf.data), enabled: Boolean(pdf.data) });
  const [zoom, setZoom] = useState<Zoom>('fit');
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // The skeleton stands in until the first page has been drawn; after that the page being
  // left stays on screen until the next one is ready.
  const [drawn, setDrawn] = useState(false);
  const onRendered = useCallback(() => setDrawn(true), []);

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
    // Keys pressed in the conversation or anywhere else on the page are theirs.
    const inBook = event.target instanceof Node && root.current?.contains(event.target);
    if (event.target !== document.body && !inBook) return;
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
