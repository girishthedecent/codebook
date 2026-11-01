import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus } from '@phosphor-icons/react';
import type { Source } from '@/api/types';
import { Button, SourceBadge, StatusDot, TextButton } from '@/ui';
import { AddSourceDialog } from './AddSourceDialog';
import { nameOf, stuckMinutes } from './sourceInfo';
import { isIndexing } from './sourceMeta';
import { strings } from './strings';
import { useNow, useSourceList } from './useSourceList';
import { useSourceAccess } from './useSourceAccess';

const SHOWN = 8;

/**
 * The sources block in the sidebar: a heading with an add button for owners, the first few
 * sources, and a link to the full list. A dot marks anything that isn't ready yet.
 */
export function SourcesSection({
  workspaceId,
  collapsed,
}: {
  workspaceId: string;
  collapsed: boolean;
}) {
  const query = useSourceList(workspaceId);
  const { canManage } = useSourceAccess(workspaceId);
  const [adding, setAdding] = useState(false);
  const { sources } = query;
  const now = useNow(sources.some((s) => isIndexing(s.status)));
  if (collapsed) return null;

  const shown = sources.slice(0, SHOWN);

  return (
    <section aria-labelledby="sidebar-sources" className="px-2">
      <div className="flex min-h-8 items-center justify-between pl-2 max-sm:min-h-10">
        <h2 id="sidebar-sources" className="text-xs font-medium text-ink-3">
          {strings.title}
        </h2>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAdding(true)}
            aria-label={strings.add}
            title={strings.add}
          >
            <Plus size={14} aria-hidden />
          </Button>
        )}
      </div>
      <ul>
        {shown.map((source) => {
          const { name } = nameOf(source);
          return (
            <li key={source.id}>
              <Link
                to="/w/$workspaceId/sources/$sourceId"
                params={{ workspaceId, sourceId: source.id }}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-ink-2 hover:bg-paper-3 hover:text-ink max-sm:min-h-11 [&.active]:font-medium [&.active]:text-ink"
              >
                <SourceBadge type={source.type} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <Dot source={source} now={now} />
              </Link>
            </li>
          );
        })}
      </ul>
      {query.isError && (
        <p role="alert" className="px-2 py-1.5 text-xs text-error">
          {strings.loadFailed}{' '}
          <TextButton onClick={() => void query.refetch()}>{strings.retry}</TextButton>
        </p>
      )}
      {(sources.length > SHOWN || (sources.length === 0 && !query.isPending && !query.isError)) && (
        <Link
          to="/w/$workspaceId/sources"
          params={{ workspaceId }}
          className="block px-2 py-1.5 text-xs text-ink-3 hover:text-accent max-sm:py-3"
        >
          {sources.length === 0 && canManage ? strings.add : strings.all}
        </Link>
      )}
      {canManage && (
        <Link
          to="/w/$workspaceId/highlights"
          params={{ workspaceId }}
          className="block px-2 py-1.5 text-xs text-ink-3 hover:text-accent max-sm:py-3 [&.active]:text-ink"
        >
          {strings.library.highlights}
        </Link>
      )}
      {canManage && (
        <AddSourceDialog workspaceId={workspaceId} open={adding} onOpenChange={setAdding} />
      )}
    </section>
  );
}

function Dot({ source, now }: { source: Source; now: number }) {
  if (source.status === 'READY') return null;
  if (source.status === 'FAILED') return <StatusDot tone="error" label="Failed" hideLabel />;
  if (stuckMinutes(source, now) !== undefined) {
    return <StatusDot tone="warn" label="No progress" hideLabel />;
  }
  return <StatusDot tone="accent" label="Indexing" hideLabel />;
}
