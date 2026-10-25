import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { flatItems } from '@/api/queries/keys';
import { useSources } from '@/api/queries/sources';
import { cn } from '@/lib/cn';
import { AddSourceDialog } from './AddSourceDialog';
import { isIndexing, typeMark } from './sourceMeta';
import { strings } from './strings';
import { useSourceAccess } from './useSourceAccess';

const SHOWN = 8;

/**
 * The sources block in the sidebar: a heading with an add button for owners, the first few
 * sources, and a link to the full list. A small dot marks anything that isn't ready yet.
 */
export function SourcesSection({
  workspaceId,
  collapsed,
}: {
  workspaceId: string;
  collapsed: boolean;
}) {
  const query = useSources(workspaceId);
  const { canManage } = useSourceAccess(workspaceId);
  const [adding, setAdding] = useState(false);
  if (collapsed) return null;

  const sources = flatItems(query.data);
  const shown = sources.slice(0, SHOWN);

  return (
    <section aria-labelledby="sidebar-sources" className="px-2">
      <div className="flex h-8 items-center justify-between px-2">
        <h2 id="sidebar-sources" className="text-xs font-medium text-ink-3">
          {strings.title}
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={strings.add}
            title={strings.add}
            className="flex size-6 items-center justify-center rounded-xs text-sm text-ink-3 hover:bg-paper-3 hover:text-ink"
          >
            +
          </button>
        )}
      </div>
      <ul>
        {shown.map((source) => (
          <li key={source.id}>
            <Link
              to="/w/$workspaceId/sources/$sourceId"
              params={{ workspaceId, sourceId: source.id }}
              className="flex items-baseline gap-2 rounded-sm px-2 py-1.5 text-sm text-ink-2 hover:bg-paper-3 hover:text-ink [&.active]:text-ink [&.active]:font-medium"
            >
              <span className="w-8 shrink-0 font-mono text-[11px] text-ink-3">
                {typeMark[source.type]}
              </span>
              <span className="min-w-0 flex-1 truncate">{source.title}</span>
              {source.status !== 'READY' && (
                <span
                  aria-label={strings.status[source.status]}
                  title={strings.status[source.status]}
                  className={cn(
                    'size-1.5 shrink-0 translate-y-[-1px] rounded-full',
                    isIndexing(source.status) ? 'bg-warn' : 'bg-error',
                  )}
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
      {(sources.length > SHOWN || sources.length === 0) && (
        <Link
          to="/w/$workspaceId/sources"
          params={{ workspaceId }}
          className="block px-2 py-1.5 text-xs text-ink-3 hover:text-accent"
        >
          {sources.length === 0 && !query.isPending ? strings.add : strings.all}
        </Link>
      )}
      {canManage && (
        <AddSourceDialog workspaceId={workspaceId} open={adding} onOpenChange={setAdding} />
      )}
    </section>
  );
}
