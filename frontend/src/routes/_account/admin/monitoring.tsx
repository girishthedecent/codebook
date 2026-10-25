import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { MonitoringPage } from '@/features/admin/monitoring/MonitoringPage';
import { RANGES, type RangeDays } from '@/features/admin/monitoring/ranges';

export const Route = createFileRoute('/_account/admin/monitoring')({
  validateSearch: z.object({
    days: z.coerce
      .number()
      .refine((d): d is RangeDays => (RANGES as readonly number[]).includes(d))
      .optional()
      .catch(undefined),
  }),
  component: function MonitoringRoute() {
    const { days } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <MonitoringPage
        range={(days ?? 7) as RangeDays}
        onRange={(r) => void navigate({ search: { days: r === 7 ? undefined : r }, replace: true })}
      />
    );
  },
});
