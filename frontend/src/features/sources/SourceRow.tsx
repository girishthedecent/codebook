import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { DotsThree } from '@phosphor-icons/react';
import { useResyncSource } from '@/api/queries/sources';
import type { Source } from '@/api/types';
import { cn } from '@/lib/cn';
import { Button, Callout, Menu, MenuItem, MenuSeparator, SourceBadge } from '@/ui';
import { DeleteSourceDialog } from './DeleteSourceDialog';
import { SourceStatus } from './SourceStatus';
import { colophon, nameOf, stuckMinutes } from './sourceInfo';
import { isIndexing } from './sourceMeta';
import { strings } from './strings';

/** One source in the library: badge, title, a line about it, and its progress when indexing. */
export function SourceRow({
  source,
  workspaceId,
  canManage,
  now,
  highlighted,
}: {
  source: Source;
  workspaceId: string;
  canManage: boolean;
  now: number;
  highlighted?: boolean;
}) {
  const navigate = useNavigate();
  const resync = useResyncSource(workspaceId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const row = useRef<HTMLLIElement>(null);

  // A source that was just added is where the eye should land.
  useEffect(() => {
    if (highlighted) row.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlighted]);

  const { name, ref } = nameOf(source);
  const line = colophon(source);
  const stuck = stuckMinutes(source, now) !== undefined;
  const canRetry = isIndexing(source.status) ? stuck : true;

  return (
    <li
      ref={row}
      className={cn(
        'group relative -mx-3 rounded-md px-3 py-4 transition-colors duration-700 ease-out hover:bg-paper-2',
        highlighted && 'bg-accent-wash',
      )}
    >
      <div className="flex items-start gap-3">
        <SourceBadge type={source.type} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="heading-minor min-w-0 [overflow-wrap:anywhere]">
            <Link
              to="/w/$workspaceId/sources/$sourceId"
              params={{ workspaceId, sourceId: source.id }}
              className="text-ink after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-2"
            >
              {name}
            </Link>
            {ref && <span className="ml-1.5 font-mono text-xs font-normal text-ink-3">@{ref}</span>}
          </h2>
          {line && <p className="mt-0.5 text-xs text-ink-3">{line}</p>}
          <SourceStatus
            source={source}
            now={now}
            canManage={canManage}
            onRetry={() => resync.mutate(source.id)}
            retrying={resync.isPending}
            className="relative mt-2"
          />
          {resync.error && <Callout error={resync.error} className="relative mt-2" />}
        </div>
        <Menu
          align="end"
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Actions for ${name}`}
              className="relative shrink-0"
            >
              <DotsThree size={18} weight="bold" />
            </Button>
          }
        >
          <MenuItem
            onSelect={() =>
              navigate({
                to: '/w/$workspaceId/sources/$sourceId',
                params: { workspaceId, sourceId: source.id },
              })
            }
          >
            {strings.open}
          </MenuItem>
          {canManage && (
            <>
              <MenuItem onSelect={() => resync.mutate(source.id)} disabled={!canRetry}>
                {strings.resync}
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={() => setConfirmDelete(true)}>
                {strings.delete}
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
      {canManage && (
        <DeleteSourceDialog
          source={source}
          workspaceId={workspaceId}
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
        />
      )}
    </li>
  );
}
