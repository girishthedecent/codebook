import { createFileRoute } from '@tanstack/react-router';
import { SourceDetail } from '@/features/sources/SourceDetail';

export const Route = createFileRoute('/w/$workspaceId/sources/$sourceId')({
  component: SourceDetail,
});
