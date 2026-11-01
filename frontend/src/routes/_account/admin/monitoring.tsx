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
    // Eval runs and the demo owner are left out of the numbers unless this is on.
    system: z.boolean().optional().catch(undefined),
  }),
  component: function MonitoringRoute() {
    const { days, system } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <MonitoringPage
        range={(days ?? 7) as RangeDays}
        onRange={(r) =>
          void navigate({
            search: (prev) => ({ ...prev, days: r === 7 ? undefined : r }),
            replace: true,
          })
        }
        system={system ?? false}
        onSystem={(on) =>
          void navigate({ search: (prev) => ({ ...prev, system: on || undefined }), replace: true })
        }
      />
    );
  },
});
