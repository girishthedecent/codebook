import { createFileRoute, redirect } from '@tanstack/react-router';
import { demoQueryOptions } from '@/api/queries/demo';
import { meQueryOptions } from '@/api/queries/me';
import { Shell } from '@/features/shell/Shell';
import { viewerSearchSchema } from '@/lib/viewerParams';
import { requireUser, type GuardArgs } from '@/auth/guards';

// A link into the demo workspace works for anyone: a visitor with no session is sent through
// the demo entry, which starts a guest session and comes back here, rather than to sign-in.
async function openToDemoVisitors(args: GuardArgs & { params: { workspaceId: string } }) {
  const { queryClient } = args.context;
  if (await queryClient.ensureQueryData(meQueryOptions)) return;
  const demo = await queryClient.ensureQueryData(demoQueryOptions).catch(() => undefined);
  if (demo?.workspace.id === args.params.workspaceId) {
    throw redirect({ href: `/demo?next=${encodeURIComponent(args.location.href)}` });
  }
}

// Everything inside a workspace shares the shell: navigation, the main area, the viewer.
// The viewer's search params are declared here so every child route can set them.
export const Route = createFileRoute('/w/$workspaceId')({
  validateSearch: viewerSearchSchema,
  beforeLoad: async (args) => {
    await openToDemoVisitors(args);
    return requireUser(args);
  },
  component: Shell,
});
