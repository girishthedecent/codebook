import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Plus } from '@phosphor-icons/react';
import { Button, Callout, EmptyState, PageHeader, PageLoading } from '@/ui';
import { AddSourceDialog } from './AddSourceDialog';
import { SourceRow } from './SourceRow';
import { WorkspaceSearch } from './WorkspaceSearch';
import { isIndexing } from './sourceMeta';
import { SOURCE_LIMIT, strings } from './strings';
import { useNow, useSourceList } from './useSourceList';
import { useSourceAccess } from './useSourceAccess';

/** The library: every source in the workspace, newest first, with progress while indexing. */
export function SourcesPage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/sources/' });
  const query = useSourceList(workspaceId);
  const { sources } = query;
  const { canManage, isGuest, isDemo } = useSourceAccess(workspaceId);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string>();
  const indexing = sources.some((s) => isIndexing(s.status));
  const now = useNow(indexing);

  // The highlight on a new source fades after a few seconds.
  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(undefined), 4000);
    return () => clearTimeout(timer);
  }, [added]);

  const note = isGuest ? strings.guestNoWrite : isDemo ? strings.demoReadOnly : undefined;

  return (
    <div className="mx-auto w-full max-w-narrow px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        title={strings.title}
        intro={note ?? strings.intro}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={14} weight="bold" aria-hidden />
              {strings.add}
            </Button>
          )
        }
      />

      {query.isPending ? (
        <PageLoading label="Loading sources" rows={3} />
      ) : query.isError && sources.length === 0 ? (
        <Callout error={query.error} onRetry={() => void query.refetch()} />
      ) : sources.length === 0 ? (
        <EmptyState
          action={
            canManage && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                {strings.add}
              </Button>
            )
          }
        >
          {canManage ? strings.empty : strings.emptyReadOnly}
        </EmptyState>
      ) : (
        <>
          {query.isError && (
            <Callout error={query.error} onRetry={() => void query.refetch()} className="mb-4" />
          )}
          <p className="mb-2 flex flex-wrap justify-between gap-x-4 text-xs text-ink-3">
            <span>{strings.count(sources.length, SOURCE_LIMIT)}</span>
            {indexing && <span>{strings.leaveNote}</span>}
          </p>
          <ul>
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                workspaceId={workspaceId}
                canManage={canManage}
                now={now}
                highlighted={source.id === added}
              />
            ))}
          </ul>
          {query.hasNextPage && (
            <Button
              variant="ghost"
              className="mt-3"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {strings.loadMore}
            </Button>
          )}
          {sources.some((s) => s.status === 'READY') && (
            <WorkspaceSearch workspaceId={workspaceId} />
          )}
        </>
      )}

      {canManage && (
        <AddSourceDialog
          workspaceId={workspaceId}
          open={adding}
          onOpenChange={setAdding}
          onAdded={(source) => setAdded(source.id)}
        />
      )}
    </div>
  );
}
