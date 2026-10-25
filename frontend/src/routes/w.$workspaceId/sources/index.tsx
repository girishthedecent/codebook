import { createFileRoute } from '@tanstack/react-router';
import { SourcesPage } from '@/features/sources/SourcesPage';

export const Route = createFileRoute('/w/$workspaceId/sources/')({
  component: SourcesPage,
});
