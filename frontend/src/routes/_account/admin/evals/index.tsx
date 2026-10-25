import { createFileRoute } from '@tanstack/react-router';
import { RunsPage } from '@/features/admin/evals/RunsPage';

export const Route = createFileRoute('/_account/admin/evals/')({
  component: RunsPage,
});
