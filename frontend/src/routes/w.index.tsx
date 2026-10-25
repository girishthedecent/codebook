import { createFileRoute, redirect } from '@tanstack/react-router';
import { demoQueryOptions } from '@/api/queries/demo';
import { flatItems } from '@/api/queries/keys';
import { workspacesQueryOptions } from '@/api/queries/workspaces';
import { requireUser } from '@/auth';
import { FirstWorkspace } from '@/features/workspaces/FirstWorkspace';
import { lastWorkspaceId } from '@/features/workspaces/lastWorkspace';

// `/w` picks a workspace: the last one used if it still exists, else the first, else the
// "make your first workspace" page. Guests always go to the demo.
export const Route = createFileRoute('/w/')({
  beforeLoad: async (args) => {
    const { me } = await requireUser(args);
    const { queryClient } = args.context;
    if (me.isGuest) {
      const demo = await queryClient.ensureQueryData(demoQueryOptions);
      throw redirect({
        to: '/w/$workspaceId',
        params: { workspaceId: demo.workspace.id },
        replace: true,
      });
    }
    const workspaces = flatItems(await queryClient.ensureInfiniteQueryData(workspacesQueryOptions));
    const last = lastWorkspaceId();
    const pick = workspaces.find((w) => w.id === last) ?? workspaces[0];
    if (pick) {
      throw redirect({ to: '/w/$workspaceId', params: { workspaceId: pick.id }, replace: true });
    }
  },
  component: FirstWorkspace,
});
