import { lazy, Suspense, useCallback, useState } from 'react';
import { useSourceContent } from '@/api/queries';
import { useMe } from '@/auth';
import { ProgressRule } from '@/ui';
import { PageBar } from './PageBar';
import { Highlighted } from './Highlighted';
import { ViewError } from './ViewError';
import { s } from './strings';

// pdf.js is the heaviest thing in the app; only owners opening a book page download it.
const PdfBook = lazy(() => import('./PdfBook'));

export type BookViewProps = {
  sourceId: string;
  page: number;
  snippet?: string;
  onPage: (page: number) => void;
};

/**
 * A book page. Owners see the real page from the PDF; guests, and anyone the file is
 * refused to, read the page's text (an excerpt in the demo).
 */
export function BookView(props: BookViewProps) {
  const { isGuest } = useMe();
  const [noPdf, setNoPdf] = useState<string>();
  const { sourceId, page, onPage } = props;
  const go = (next: number) => next !== page && onPage(Math.max(1, next));
  // Stable, because the PDF page redraws whenever its callbacks change.
  const unavailable = useCallback(() => setNoPdf(sourceId), [sourceId]);

  if (!isGuest && noPdf !== sourceId) {
    return (
      <Suspense fallback={<Frame page={page} onGo={go} loading />}>
        <PdfBook {...props} onUnavailable={unavailable} />
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

function Frame({
  page,
  onGo,
  loading,
}: {
  page: number;
  onGo: (p: number) => void;
  loading?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageBar page={page} onGo={onGo} />
      {loading && <ProgressRule label={s.loading} />}
    </div>
  );
}

function TextPage({ sourceId, page, snippet }: Omit<BookViewProps, 'onPage'>) {
  const content = useSourceContent(sourceId, { page });
  const data = content.data && 'page' in content.data ? content.data : undefined;

  if (content.isError) return <ViewError error={content.error} onRetry={() => content.refetch()} />;
  return (
    <>
      {content.isPending && <ProgressRule label={s.loading} />}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        {data?.excerpt && <p className="mb-4 font-mono text-xs text-ink-3">{s.excerpt}</p>}
        {data &&
          (data.text.trim() ? (
            <Highlighted text={data.text} snippet={snippet} className="prose max-w-[64ch]" />
          ) : (
            <p className="text-ink-3">{s.noText}</p>
          ))}
      </div>
    </>
  );
}
