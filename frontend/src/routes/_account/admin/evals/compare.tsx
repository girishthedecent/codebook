import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { BackLink, Callout } from '@/ui';
import { ComparePage } from '@/features/admin/evals/ComparePage';
import { strings } from '@/features/admin/strings';

export const Route = createFileRoute('/_account/admin/evals/compare')({
  validateSearch: z.object({ a: z.string().min(1), b: z.string().min(1) }),
  // A hand-edited or truncated link lands here instead of on the generic error page.
  errorComponent: () => (
    <div>
      <BackLink to="/admin/evals">{strings.evals.runs}</BackLink>
      <Callout tone="warn" className="mt-4">
        {strings.evals.compareLink}
      </Callout>
    </div>
  ),
  component: function CompareRoute() {
    const { a, b } = Route.useSearch();
    return <ComparePage a={a} b={b} />;
  },
});
