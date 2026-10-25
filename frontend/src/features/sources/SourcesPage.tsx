import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { flatItems } from '@/api/queries/keys';
import { useSources } from '@/api/queries/sources';
import { Button, Spinner } from '@/ui';
import { AddSourceDialog } from './AddSourceDialog';
import { SourceRow } from './SourceRow';
import { strings } from './strings';
import { useSourceAccess } from './useSourceAccess';

/** Every source in the workspace, newest first, with live progress for the ones indexing. */
export function SourcesPage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/sources/' });
  const query = useSources(workspaceId);
  const { canManage, isGuest } = useSourceAccess(workspaceId);
  const [adding, setAdding] = useState(false);
  const sources = flatItems(query.data);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6 sm:px-6">
      <header className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-lg font-semibold">{strings.title}</h1>
        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            {strings.add}
          </Button>
        )}
      </header>
      {isGuest && <p className="mt-3 text-sm text-ink-3">{strings.guestNoWrite}</p>}

      {query.isPending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ink-3">
          <Spinner className="size-3.5" /> Loading
        </div>
      ) : query.isError ? (
        <p className="py-6 text-sm text-error">{query.error.message}</p>
      ) : sources.length === 0 ? (
        <div className="py-8">
          <p className="max-w-[52ch] text-sm text-ink-2">{strings.empty}</p>
          {canManage && (
            <Button variant="secondary" className="mt-4" onClick={() => setAdding(true)}>
              {strings.add}
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul>
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                workspaceId={workspaceId}
                canManage={canManage}
              />
            ))}
          </ul>
          {query.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {strings.loadMore}
            </Button>
          )}
        </>
      )}

      {canManage && (
        <AddSourceDialog workspaceId={workspaceId} open={adding} onOpenChange={setAdding} />
      )}
    </div>
  );
}
