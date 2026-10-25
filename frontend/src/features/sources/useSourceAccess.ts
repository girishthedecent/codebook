import { useIsDemoWorkspace, useDemo } from '@/api/queries/demo';
import { useMe } from '@/auth/useMe';

/**
 * Who may change sources here. Guests never can, and the demo workspace is read-only for
 * everyone who visits it from the app (it is seeded, not managed by hand). Until the demo
 * payload arrives we can't tell the two apart, so the actions stay hidden rather than flash.
 */
export function useSourceAccess(workspaceId: string) {
  const { isGuest } = useMe();
  const isDemo = useIsDemoWorkspace(workspaceId);
  const checking = useDemo().isPending;
  return { canManage: !isGuest && !isDemo && !checking, isGuest, isDemo };
}
