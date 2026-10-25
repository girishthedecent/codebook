import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { flatItems } from '@/api/queries/keys';
import { useSources } from '@/api/queries/sources';
import { Button, Spinner } from '@/ui';
import { AddSourceDialog } from './AddSourceDialog';
import { LoadError } from './LoadError';
import { SourceRow } from './SourceRow';
import { WorkspaceSearch } from './WorkspaceSearch';
import { strings } from './strings';
import { useSourceAccess } from './useSourceAccess';

/** Every source in the workspace, newest first, with live progress for the ones indexing. */
export function SourcesPage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/sources/' });
  const query = useSources(workspaceId);
  const { canManage, isGuest, isDemo } = useSourceAccess(workspaceId);
  const [adding, setAdding] = useState(false);
  const sources = flatItems(query.data);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6 sm:px-6">
      <header className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-lg font-semibold">{strings.title}</h1>
        {canManage && (
          <Button
            variant="primary"
            size="sm"
            className="max-sm:h-10"
            onClick={() => setAdding(true)}
          >
            {strings.add}
          </Button>
        )}
      </header>
      {isGuest ? (
        <p className="mt-3 text-sm text-ink-3">{strings.guestNoWrite}</p>
      ) : (
        isDemo && <p className="mt-3 text-sm text-ink-3">{strings.demoReadOnly}</p>
      )}

      {query.isPending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ink-3">
          <Spinner className="size-3.5" /> Loading
        </div>
      ) : query.isError && sources.length === 0 ? (
        <LoadError
          error={query.error}
          onRetry={() => void query.refetch()}
          className="py-6 text-sm"
        />
      ) : sources.length === 0 ? (
        <div className="py-8">
          <p className="max-w-[52ch] text-sm text-ink-2">
            {canManage ? strings.empty : strings.emptyReadOnly}
          </p>
          {canManage && (
            <Button
              variant="secondary"
              className="mt-4 max-sm:h-10"
              onClick={() => setAdding(true)}
            >
              {strings.add}
            </Button>
          )}
        </div>
      ) : (
        <>
          {query.isError && (
            <p role="alert" className="mt-3 text-sm break-words text-error">
              {query.error.message}{' '}
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="py-2 text-accent underline underline-offset-2"
              >
                {strings.retry}
              </button>
            </p>
          )}
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
              className="mt-3 max-sm:h-10"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {strings.loadMore}
            </Button>
          )}
          {canManage && sources.some((s) => s.status === 'READY') && (
            <WorkspaceSearch workspaceId={workspaceId} />
          )}
        </>
      )}

      {canManage && (
        <AddSourceDialog workspaceId={workspaceId} open={adding} onOpenChange={setAdding} />
      )}
    </div>
  );
}
