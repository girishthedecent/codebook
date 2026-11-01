import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '@/auth';
import { AccountLayout } from '@/features/account/AccountLayout';
import { shellWorkspaceId } from '@/features/account/lastWorkspaceId';

// Pathless layout for /memory, /usage, /settings and /admin: signed-in users (guests included).
// The pages open in the workspace frame, so the layout needs to know which workspace to show.
export const Route = createFileRoute('/_account')({
  beforeLoad: async (args) => {
    const { me } = await requireUser(args);
    return { shellWorkspaceId: await shellWorkspaceId(args.context.queryClient, me.isGuest) };
  },
  component: AccountLayout,
});
