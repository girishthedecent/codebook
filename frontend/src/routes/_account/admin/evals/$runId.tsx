import { createFileRoute } from '@tanstack/react-router';
import { RunDetail } from '@/features/admin/evals/RunDetail';

export const Route = createFileRoute('/_account/admin/evals/$runId')({
  component: function RunRoute() {
    const { runId } = Route.useParams();
    return <RunDetail runId={runId} />;
  },
});
