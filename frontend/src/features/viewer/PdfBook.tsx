import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProgressRule } from '@/ui';
import { pdfDocumentOptions } from './pdf';
import { PdfPage } from './PdfPage';
import { PageBar, type Zoom } from './PageBar';
import type { BookViewProps } from './BookView';
import { s } from './strings';

type Props = BookViewProps & { onUnavailable: () => void };

/** The real page from the original PDF. Says so when the file can't be had, so the text shows. */
export default function PdfBook({ sourceId, page, snippet, onPage, onUnavailable }: Props) {
  const pdf = useQuery(pdfDocumentOptions(sourceId));
  const [zoom, setZoom] = useState<Zoom>('fit');
  // The page counts as loading until the canvas for this page and zoom has been drawn.
  const drawKey = `${page}:${zoom}`;
  const [drawnKey, setDrawnKey] = useState<string>();
  const onRendered = useCallback(() => setDrawnKey(drawKey), [drawKey]);

  useEffect(() => {
    if (pdf.isError) onUnavailable();
  }, [pdf.isError, onUnavailable]);

  const pageCount = pdf.data?.numPages;
  const go = (next: number) => {
    const clamped = Math.max(1, pageCount ? Math.min(pageCount, next) : next);
    if (clamped !== page) onPage(clamped);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageBar page={page} pageCount={pageCount} onGo={go} zoom={zoom} onZoom={setZoom} />
      {(pdf.isPending || drawnKey !== drawKey) && <ProgressRule label={s.loading} />}
      <div className="min-h-0 flex-1 overflow-auto bg-paper-2 p-3 [touch-action:pan-x_pan-y_pinch-zoom] sm:p-4">
        {pdf.data && (
          <PdfPage
            doc={pdf.data}
            page={page}
            zoom={zoom}
            snippet={snippet}
            onRendered={onRendered}
            onError={onUnavailable}
          />
        )}
      </div>
    </div>
  );
}
