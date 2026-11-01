import { Outlet, useParams, useSearch } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { useWorkspace } from '@/api/queries/workspaces';
import { NotFound } from '@/ui';
import { viewerTarget } from '@/lib/viewerParams';
import { useIndexingNotices } from '@/features/sources/useIndexingNotices';
import { useSourceList } from '@/features/sources/useSourceList';
import { useRememberWorkspace } from '@/features/workspaces/lastWorkspace';
import { ShellFrame } from './ShellFrame';

/**
 * The route component for everything inside a workspace. The viewer opens whenever the
 * address names a target; closing it clears those params.
 */
export function Shell() {
  const search = useSearch({ from: '/w/$workspaceId' });
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  useRememberWorkspace(workspaceId);
  // Watched here, not in the sidebar's source list, which phones and tablets show only when opened.
  useIndexingNotices(workspaceId, useSourceList(workspaceId).sources);

  // A workspace that is missing or belongs to someone else gets a plain page, not an empty shell.
  const workspace = useWorkspace(workspaceId);
  if (isApiError(workspace.error, 404) || isApiError(workspace.error, 403)) return <NotFound />;

  return (
    <ShellFrame workspaceId={workspaceId} target={viewerTarget(search)}>
      <Outlet />
    </ShellFrame>
  );
}
