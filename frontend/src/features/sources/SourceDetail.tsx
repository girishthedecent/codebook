import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { useResyncSource, useSource } from '@/api/queries/sources';
import type { Source } from '@/api/types';
import { BackLink, Button, Spinner } from '@/ui';
import { DeleteSourceDialog } from './DeleteSourceDialog';
import { FileTree } from './FileTree';
import { PageList } from './PageList';
import { SourceProgress, StatusText } from './SourceStatus';
import { TocTree } from './TocTree';
import { isIndexing, secondaryLine, typeMark } from './sourceMeta';
import { strings } from './strings';
import { useProgressStream } from './useProgressStream';
import { useSourceAccess } from './useSourceAccess';

const d = strings.detail;

/** One source: what it is, its state, and a way into its contents. */
export function SourceDetail() {
  const { workspaceId, sourceId } = useParams({ from: '/w/$workspaceId/sources/$sourceId' });
  const query = useSource(sourceId);
  const { canManage } = useSourceAccess(workspaceId);

  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-3 sm:px-6">
        <Spinner className="size-3.5" /> Loading
      </div>
    );
  }
  // A failed background refetch keeps showing what we have; only a 404 means it's gone.
  if (query.isError && (!query.data || isApiError(query.error, 404))) {
    return (
      <div className="mx-auto max-w-[760px] px-4 py-6 text-sm sm:px-6">
        <p className="break-words text-error">
          {isApiError(query.error, 404) ? strings.gone : query.error.message}
        </p>
        {!isApiError(query.error, 404) && (
          <Button size="sm" className="mt-3 max-sm:h-10" onClick={() => void query.refetch()}>
            {strings.retry}
          </Button>
        )}
        <BackLink to="/w/$workspaceId/sources" params={{ workspaceId }} className="mt-3">
          {strings.all}
        </BackLink>
      </div>
    );
  }
  return <Detail source={query.data!} workspaceId={workspaceId} canManage={canManage} />;
}

function Detail({
  source,
  workspaceId,
  canManage,
}: {
  source: Source;
  workspaceId: string;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const resync = useResyncSource(workspaceId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useProgressStream(workspaceId, source.id, isIndexing(source.status));
  const ready = source.status === 'READY';

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6 sm:px-6">
      <BackLink to="/w/$workspaceId/sources" params={{ workspaceId }}>
        {strings.all}
      </BackLink>

      <header className="mt-3 border-b border-rule pb-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-ink-3">{typeMark[source.type]}</span>
          <StatusText source={source} />
        </div>
        <h1 className="mt-1 text-lg font-semibold break-words">{source.title}</h1>
        <SourceProgress source={source} className="mt-2" />
        <Facts source={source} />
        {source.status === 'FAILED' && source.error && (
          <p className="mt-3 text-sm break-words text-error">
            {d.failed}: {source.error}
          </p>
        )}
        {resync.error && (
          <p role="alert" className="mt-2 text-sm break-words text-error">
            {resync.error.message}
          </p>
        )}
        {canManage && (
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              className="max-sm:h-10"
              onClick={() => resync.mutate(source.id)}
              loading={resync.isPending}
              disabled={isIndexing(source.status)}
            >
              {source.status === 'FAILED' ? strings.retryIndex : strings.resync}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-error! hover:bg-error-wash! max-sm:h-10"
              onClick={() => setConfirmDelete(true)}
            >
              {strings.delete}
            </Button>
          </div>
        )}
      </header>

      {isIndexing(source.status) && <p className="mt-6 text-sm text-ink-3">{d.waiting}</p>}

      {ready && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-ink">
            {source.type === 'PDF' ? d.contents : source.type === 'GITHUB_REPO' ? d.files : d.pages}
          </h2>
          {source.type === 'PDF' && <TocTree sourceId={source.id} />}
          {source.type === 'GITHUB_REPO' && <FileTree sourceId={source.id} />}
          {source.type === 'WEBSITE' && <PageList sourceId={source.id} />}
        </section>
      )}

      {canManage && (
        <DeleteSourceDialog
          source={source}
          workspaceId={workspaceId}
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          onDeleted={() =>
            void navigate({ to: '/w/$workspaceId/sources', params: { workspaceId } })
          }
        />
      )}
    </div>
  );
}

type Stats = { chunks?: number; tokens?: number; graph?: { symbols?: number; edges?: number } };

/** The few numbers that say how much was indexed, in one mono line. */
function Facts({ source }: { source: Source }) {
  const stats = source.stats as Stats;
  const parts = [
    secondaryLine(source),
    stats.chunks ? `${stats.chunks.toLocaleString()} passages` : '',
    stats.graph?.symbols ? `${stats.graph.symbols} symbols` : '',
    source.lastIngestedAt ? `indexed ${formatDate(source.lastIngestedAt)}` : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="mt-2 font-mono text-xs text-ink-3">{parts.join(' · ')}</p>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
