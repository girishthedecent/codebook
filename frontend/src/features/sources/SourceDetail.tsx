import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { useResyncSource, useSource } from '@/api/queries/sources';
import type { Source } from '@/api/types';
import { BackLink, Button, Callout, PageLoading, SectionHeading, SourceBadge } from '@/ui';
import { DeleteSourceDialog } from './DeleteSourceDialog';
import { FileTree } from './FileTree';
import { SourceHighlights } from './HighlightList';
import { LeftOut } from './LeftOut';
import { SitePages } from './PageList';
import { SourceStatus } from './SourceStatus';
import { TocTree } from './TocTree';
import {
  colophon,
  failureText,
  mainLanguages,
  nameOf,
  originOf,
  shortDate,
  stuckMinutes,
  formatBytes,
  type PdfOrigin,
  type SiteOrigin,
} from './sourceInfo';
import { hostOf, isIndexing } from './sourceMeta';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';
import { useProgressStream } from './useProgressStream';
import { useNow } from './useSourceList';
import { useSourceAccess } from './useSourceAccess';

const d = strings.detail;

/** One source: what it is, where indexing stands, and a way into its contents. */
export function SourceDetail() {
  const { workspaceId, sourceId } = useParams({ from: '/w/$workspaceId/sources/$sourceId' });
  const query = useSource(sourceId);
  const { canManage } = useSourceAccess(workspaceId);

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-narrow px-4 py-8 sm:px-6 sm:py-10">
        <PageLoading label="Loading the source" rows={3} />
      </div>
    );
  }
  // A failed background refetch keeps showing what we have; only a 404 means it's gone.
  if (query.isError && (!query.data || isApiError(query.error, 404))) {
    return (
      <div className="mx-auto w-full max-w-narrow px-4 py-8 sm:px-6 sm:py-10">
        <BackLink to="/w/$workspaceId/sources" params={{ workspaceId }}>
          {strings.all}
        </BackLink>
        <Callout
          className="mt-4"
          error={isApiError(query.error, 404) ? new Error(strings.gone) : query.error}
          onRetry={isApiError(query.error, 404) ? undefined : () => void query.refetch()}
        />
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
  const openInViewer = useOpenInViewer();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const indexing = isIndexing(source.status);
  const now = useNow(indexing);
  const stuck = stuckMinutes(source, now) !== undefined;
  // A quiet run has nothing more to say, so its stream is dropped until a retry.
  useProgressStream(workspaceId, source.id, indexing && !stuck);

  const ready = source.status === 'READY';
  // The old index keeps serving while a new one is built, and after a build that failed.
  const hasIndex = source.lastIngestedAt !== null;
  const { name, ref } = nameOf(source);
  const line = colophon(source);
  const retry = () => resync.mutate(source.id);
  const canIndexAgain = canManage && !indexing && source.status !== 'FAILED';

  return (
    <div className="mx-auto w-full max-w-narrow px-4 py-8 sm:px-6 sm:py-10">
      <BackLink to="/w/$workspaceId/sources" params={{ workspaceId }}>
        {strings.all}
      </BackLink>

      <header className="mt-4 mb-8">
        <SourceBadge type={source.type} showLabel />
        <h1 className="heading-page mt-3 min-w-0 text-ink [overflow-wrap:anywhere]">
          {name}
          {ref && <span className="ml-2 font-mono text-sm font-normal text-ink-3">@{ref}</span>}
        </h1>
        {line && <p className="mt-1.5 text-xs text-ink-3">{line}</p>}
        <Facts source={source} />

        {(!ready || stuck) && (
          <SourceStatus
            source={source}
            now={now}
            canManage={canManage}
            onRetry={retry}
            retrying={resync.isPending}
            className="mt-4 max-w-prose"
          />
        )}
        {indexing && !stuck && <p className="mt-2 text-xs text-ink-3">{strings.leaveNote}</p>}
        {resync.error && <Callout error={resync.error} className="mt-4" />}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {hasIndex && source.type === 'PDF' && (
            // A short PDF has no contents to click, so the book needs its own way in.
            <Button
              variant="primary"
              onClick={() => openInViewer({ kind: 'page', sourceId: source.id, page: 1 })}
            >
              {d.read}
            </Button>
          )}
          {canIndexAgain && (
            <Button onClick={retry} loading={resync.isPending}>
              {strings.resync}
            </Button>
          )}
          {canManage && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {strings.delete}
            </Button>
          )}
        </div>
      </header>

      {hasIndex && !ready && !stuck && <StaleBanner source={source} />}

      {indexing && !hasIndex && <p className="text-sm text-ink-3">{d.waiting}</p>}

      {hasIndex && (
        <>
          {source.type === 'PDF' && (
            <section aria-labelledby="contents">
              <SectionHeading id="contents">{d.contents}</SectionHeading>
              <TocTree sourceId={source.id} />
            </section>
          )}
          {source.type === 'GITHUB_REPO' && (
            <>
              <section aria-labelledby="files">
                <SectionHeading id="files">{d.files}</SectionHeading>
                <FileTree sourceId={source.id} />
              </section>
              <LeftOut sourceId={source.id} />
            </>
          )}
          {source.type === 'WEBSITE' && <SitePages source={source} />}
          {canManage && <SourceHighlights workspaceId={workspaceId} sourceId={source.id} />}
        </>
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

/** Says why the contents shown are from an earlier run: a new run is going, or it failed. */
function StaleBanner({ source }: { source: Source }) {
  const date = shortDate(source.lastIngestedAt!);
  if (source.status === 'FAILED') {
    return (
      <Callout tone="warn" title={strings.updateFailed} className="mb-8">
        {failureText(source)} {strings.stillAvailable(date)}
      </Callout>
    );
  }
  return <Callout className="mb-8">{strings.updating(date)}</Callout>;
}

/** The few more facts that don't fit the colophon: file, link, languages. */
function Facts({ source }: { source: Source }) {
  if (source.type === 'PDF') {
    const { fileName, size } = originOf<PdfOrigin>(source);
    if (!fileName) return null;
    return (
      <p className="mt-0.5 text-xs text-ink-3">
        {fileName}
        {size ? `, ${formatBytes(size)}` : ''}
      </p>
    );
  }
  if (source.type === 'GITHUB_REPO') {
    const { owner, repo } = originOf<{ owner?: string; repo?: string }>(source);
    const languages = mainLanguages(source);
    return (
      <>
        {languages && <p className="mt-0.5 text-xs text-ink-3">Mostly {languages}.</p>}
        {owner && repo && (
          <p className="mt-2 text-sm">
            <a
              href={`https://github.com/${owner}/${repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:text-accent-2"
            >
              {owner}/{repo} on GitHub
            </a>
          </p>
        )}
      </>
    );
  }
  const { url } = originOf<SiteOrigin>(source);
  return url ? (
    <p className="mt-0.5 min-w-0 text-xs text-ink-3 [overflow-wrap:anywhere]">{hostOf(url)}</p>
  ) : null;
}
