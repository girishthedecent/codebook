import { createFileRoute } from '@tanstack/react-router';
import { HighlightsPage } from '@/features/sources/HighlightsPage';

export const Route = createFileRoute('/w/$workspaceId/highlights')({
  component: HighlightsPage,
});
