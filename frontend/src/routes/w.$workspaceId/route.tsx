import { createFileRoute } from '@tanstack/react-router';
import { Shell } from '@/features/shell/Shell';
import { viewerSearchSchema } from '@/lib/viewerParams';
import { requireUser } from '@/auth/guards';

// Everything inside a workspace shares the shell: navigation, the main area, the viewer.
// The viewer's search params are declared here so every child route can set them.
export const Route = createFileRoute('/w/$workspaceId')({
  validateSearch: viewerSearchSchema,
  beforeLoad: requireUser,
  component: Shell,
});
