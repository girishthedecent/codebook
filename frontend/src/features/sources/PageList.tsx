import { flatItems } from '@/api/queries/keys';
import { useSourceFiles } from '@/api/queries/sources';
import { Button, Spinner } from '@/ui';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';

/** The pages a website source indexed. Usually one; a crawl can add a few more. */
export function PageList({ sourceId }: { sourceId: string }) {
  const files = useSourceFiles(sourceId);
  const openInViewer = useOpenInViewer();
  const pages = flatItems(files.data);

  if (files.isPending) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-ink-3">
        <Spinner className="size-3.5" /> Loading
      </div>
    );
  }
  if (files.isError) return <p className="py-4 text-sm text-error">{files.error.message}</p>;

  return (
    <div className="py-2">
      <ul>
        {pages.map((page) => (
          <li key={page.id} className="border-b border-rule">
            <button
              type="button"
              disabled={!!page.skippedReason}
              onClick={() => openInViewer({ kind: 'file', sourceId, path: page.path })}
              className="flex min-h-10 w-full items-center justify-between gap-3 py-2 text-left hover:text-accent disabled:text-ink-3"
            >
              <span className="min-w-0 truncate font-mono text-xs">{pathOf(page.path)}</span>
              {page.skippedReason && (
                <span className="shrink-0 text-xs text-ink-3">{strings.detail.skipped}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {files.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          loading={files.isFetchingNextPage}
          onClick={() => void files.fetchNextPage()}
        >
          {strings.loadMore}
        </Button>
      )}
    </div>
  );
}

/** "https://expressjs.com/en/guide/routing/" → "expressjs.com/en/guide/routing/". */
function pathOf(url: string) {
  try {
    const u = new URL(url);
    return u.host + u.pathname + u.search;
  } catch {
    return url;
  }
}
