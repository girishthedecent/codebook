import { useEffect, useRef, useState } from 'react';
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import { findSnippet } from './findSnippet';
import type { Zoom } from './PageBar';
import { ViewError } from './ViewError';
import { s } from './strings';

// pdf.js scale 1 is 72 dpi; CSS pixels are 96.
const CSS_UNITS = 96 / 72;
// iOS Safari refuses canvases above ~16.7M pixels.
const MAX_CANVAS_PIXELS = 16_000_000;

type Props = {
  doc: PDFDocumentProxy;
  page: number;
  zoom: Zoom;
  snippet?: string;
  onRendered?: () => void;
};

/**
 * One page: the canvas at device resolution, pdf.js's text layer above it so text can be
 * selected, and the cited passage marked in that layer. The next page is drawn off screen and
 * copied over in one step, so turning a page never shows an empty canvas in between.
 */
export function PdfPage({ doc, page, zoom, snippet, onRendered }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [failure, setFailure] = useState<{ page: number; attempt: number }>();
  const [attempt, setAttempt] = useState(0);

  // Fit-width follows the pane as it is resized.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry!.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;

    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = zoom === 'fit' ? width / base.width : zoom * CSS_UNITS;
      const viewport = pdfPage.getViewport({ scale });

      let ratio = window.devicePixelRatio || 1;
      if (viewport.width * viewport.height * ratio * ratio > MAX_CANVAS_PIXELS) {
        ratio = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
      }

      const back = document.createElement('canvas');
      back.width = Math.floor(viewport.width * ratio);
      back.height = Math.floor(viewport.height * ratio);
      renderTask = pdfPage.render({
        canvas: back,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await renderTask.promise;
      if (cancelled) return;

      // Resizing a canvas clears it, so the copy follows in the same task, before any paint.
      const front = canvasRef.current!;
      front.width = back.width;
      front.height = back.height;
      front.style.width = `${Math.floor(viewport.width)}px`;
      front.style.height = `${Math.floor(viewport.height)}px`;
      front.getContext('2d')!.drawImage(back, 0, 0);

      const container = textRef.current!;
      container.replaceChildren();
      container.parentElement!.style.setProperty('--scale-factor', String(scale));
      textLayer = new TextLayer({
        textContentSource: pdfPage.streamTextContent(),
        container,
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;
      markSnippet(textLayer, snippet)?.scrollIntoView({ block: 'center' });
      setFailure(undefined);
      onRendered?.();
    })().catch((error: unknown) => {
      if (cancelled || (error as { name?: string }).name === 'RenderingCancelledException') return;
      setFailure({ page, attempt });
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [doc, page, zoom, width, snippet, onRendered, attempt]);

  const failed = failure?.page === page && failure.attempt === attempt;

  return (
    <div ref={frameRef} className="w-full">
      {failed && <ViewError message={s.pageFailed} onRetry={() => setAttempt((n) => n + 1)} />}
      <div
        className="cb-pdf-page relative mx-auto w-fit bg-white shadow-[0_0_0_1px_var(--rule)]"
        hidden={failed}
      >
        <canvas ref={canvasRef} className="block" aria-hidden />
        <div ref={textRef} className="textLayer" />
      </div>
    </div>
  );
}

/** Marks the text items that make up the cited passage; returns the first one. */
function markSnippet(layer: TextLayer, snippet: string | undefined) {
  const items = layer.textContentItemsStr;
  const divs = layer.textDivs;
  const starts: number[] = [];
  let text = '';
  for (const item of items) {
    starts.push(text.length);
    text += item + ' ';
  }
  const range = findSnippet(text, snippet);
  if (!range) return undefined;

  let first: HTMLElement | undefined;
  starts.forEach((start, i) => {
    const end = start + items[i]!.length;
    if (end <= range.start || start >= range.end) return;
    const div = divs[i];
    if (!div) return;
    div.classList.add('cb-hit');
    first ??= div;
  });
  return first;
}
