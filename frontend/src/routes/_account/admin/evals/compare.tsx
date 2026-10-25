import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ComparePage } from '@/features/admin/evals/ComparePage';

export const Route = createFileRoute('/_account/admin/evals/compare')({
  validateSearch: z.object({ a: z.string().min(1), b: z.string().min(1) }),
  component: function CompareRoute() {
    const { a, b } = Route.useSearch();
    return <ComparePage a={a} b={b} />;
  },
});
