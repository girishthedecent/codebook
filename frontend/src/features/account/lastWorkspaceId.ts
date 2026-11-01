import type { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { demoQueryOptions } from '@/api/queries/demo';
import { flatItems } from '@/api/queries/keys';
import { workspaceQueryOptions, workspacesQueryOptions } from '@/api/queries/workspaces';

// The workspace shell writes this key when a workspace opens; pages outside a workspace read it
// to offer the way back. Read directly so this folder doesn't depend on that one.
const KEY = 'codebook.lastWorkspace';

export function readLastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * The workspace whose sidebar frames the account pages: the one last open if it still exists,
 * else the first of the person's own (the demo for a guest), else none. A request that fails
 * for another reason (offline, server asleep) keeps the remembered one rather than guessing.
 */
export async function shellWorkspaceId(
  queryClient: QueryClient,
  isGuest: boolean,
): Promise<string | null> {
  const remembered = readLastWorkspaceId();
  if (remembered) {
    try {
      await queryClient.ensureQueryData(workspaceQueryOptions(remembered));
      return remembered;
    } catch (error) {
      if (!isApiError(error, 404) && !isApiError(error, 403)) return remembered;
    }
  }
  try {
    if (isGuest) return (await queryClient.ensureQueryData(demoQueryOptions)).workspace.id;
    const own = flatItems(await queryClient.fetchInfiniteQuery(workspacesQueryOptions));
    return own[0]?.id ?? null;
  } catch {
    return null;
  }
}
