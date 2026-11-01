import { lazy, Suspense, useCallback, useState } from 'react';
import { useSourceContent } from '@/api/queries';
import { ProgressRule } from '@/ui';
import { PageBar } from './PageBar';
import { Highlighted } from './Highlighted';
import { useTextMarks } from './useTextMarks';
import { useViewerContext } from './viewerContext';
import { ViewError } from './ViewError';
import { s } from './strings';

// pdf.js is the heaviest thing in the app, so it loads only when a book page is opened.
const PdfBook = lazy(() => import('./PdfBook'));

export type BookViewProps = {
  sourceId: string;
  page: number;
  snippet?: string;
  onPage: (page: number) => void;
};

/**
 * A book page: the real page from the PDF. Whoever the file is refused to (the demo's
 * visitors, when its book isn't free to share) reads the page's text instead.
 */
export function BookView(props: BookViewProps) {
  const [noPdf, setNoPdf] = useState<string>();
  const { sourceId, page, onPage } = props;
  const go = (next: number) => next !== page && onPage(Math.max(1, next));
  // Stable, because the PDF page redraws whenever its callbacks change.
  const unavailable = useCallback(() => setNoPdf(sourceId), [sourceId]);

  if (noPdf !== sourceId) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full min-h-0 flex-col">
            <PageBar page={page} onGo={go} />
            <ProgressRule label={s.loading} />
          </div>
        }
      >
        <PdfBook key={sourceId} {...props} onUnavailable={unavailable} />
      </Suspense>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageBar page={page} onGo={go} />
      <TextPage {...props} />
    </div>
  );
}

function TextPage({ sourceId, page, snippet }: Omit<BookViewProps, 'onPage'>) {
  const content = useSourceContent(sourceId, { page });
  const data = content.data && 'page' in content.data ? content.data : undefined;
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const { highlights } = useViewerContext();
  const passages = highlights.filter((h) => h.page === page).map((h) => h.text);
  useTextMarks(body, data?.text, passages);

  if (content.isError) return <ViewError error={content.error} onRetry={() => content.refetch()} />;
  return (
    <>
      {content.isPending && <ProgressRule label={s.loading} />}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        {data?.excerpt && <p className="mb-4 text-xs text-ink-3">{s.excerpt}</p>}
        {data &&
          (data.text.trim() ? (
            <div ref={setBody} data-selectable>
              <Highlighted text={data.text} snippet={snippet} className="prose" />
            </div>
          ) : (
            <p className="text-ink-3">{s.noText}</p>
          ))}
      </div>
    </>
  );
}
