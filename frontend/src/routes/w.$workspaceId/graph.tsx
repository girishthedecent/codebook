import { createFileRoute } from '@tanstack/react-router';
import { GraphPage } from '@/features/graph/GraphPage';
import { graphSearchSchema } from '@/features/graph/search';

// The viewer's params come from the parent route; these are the graph's own.
export const Route = createFileRoute('/w/$workspaceId/graph')({
  validateSearch: graphSearchSchema,
  component: GraphPage,
});
