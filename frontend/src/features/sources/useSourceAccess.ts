import { useWorkspace } from '@/api/queries/workspaces';
import { useMe } from '@/auth/useMe';

/**
 * Who may change sources here. Guests never can, and the demo workspace is read-only for
 * everyone who visits it from the app (it is seeded, not managed by hand).
 */
export function useSourceAccess(workspaceId: string) {
  const { isGuest } = useMe();
  const workspace = useWorkspace(workspaceId);
  const isDemo = workspace.data?.isDemo ?? false;
  return { canManage: !isGuest && !isDemo, isGuest, isDemo };
}
