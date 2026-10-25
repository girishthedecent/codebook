import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { DotsThree } from '@phosphor-icons/react';
import { useResyncSource } from '@/api/queries/sources';
import type { Source } from '@/api/types';
import { Button, Menu, MenuItem, MenuSeparator } from '@/ui';
import { DeleteSourceDialog } from './DeleteSourceDialog';
import { SourceProgress, StatusText } from './SourceStatus';
import { isIndexing, secondaryLine, typeMark } from './sourceMeta';
import { strings } from './strings';
import { useProgressStream } from './useProgressStream';

/** One source in the list: mark, title, details, status, and a menu for owners. */
export function SourceRow({
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

  const detail = secondaryLine(source);
  const open = () =>
    navigate({
      to: '/w/$workspaceId/sources/$sourceId',
      params: { workspaceId, sourceId: source.id },
    });

  return (
    <li className="border-b border-rule">
      <div className="flex items-start gap-3 py-3">
        <span className="w-9 shrink-0 pt-0.5 font-mono text-xs text-ink-3">
          {typeMark[source.type]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <Link
              to="/w/$workspaceId/sources/$sourceId"
              params={{ workspaceId, sourceId: source.id }}
              className="truncate text-sm font-medium text-ink hover:underline hover:underline-offset-2"
            >
              {source.title}
            </Link>
            <StatusText source={source} className="hidden sm:inline" />
          </div>
          <SourceProgress source={source} className="mt-1.5" />
          {detail && <div className="mt-0.5 truncate font-mono text-xs text-ink-3">{detail}</div>}
          <StatusText source={source} className="mt-0.5 block sm:hidden" />
          {source.status === 'FAILED' && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {source.error && <span className="text-xs text-error">{source.error}</span>}
              {canManage && (
                <button
                  type="button"
                  onClick={() => resync.mutate(source.id)}
                  disabled={resync.isPending}
                  className="text-xs text-accent underline underline-offset-2 disabled:opacity-50"
                >
                  {strings.resync}
                </button>
              )}
            </div>
          )}
          {resync.error && <div className="mt-1 text-xs text-error">{resync.error.message}</div>}
        </div>
        <Menu
          align="end"
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Actions for ${source.title}`}
              className="-mr-2 size-11 shrink-0 px-0 sm:size-8"
            >
              <DotsThree size={18} weight="bold" />
            </Button>
          }
        >
          <MenuItem onSelect={open}>{strings.open}</MenuItem>
          {canManage && (
            <>
              <MenuItem
                onSelect={() => resync.mutate(source.id)}
                disabled={isIndexing(source.status)}
              >
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
