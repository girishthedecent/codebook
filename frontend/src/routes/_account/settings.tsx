import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createFileRoute('/_account/settings')({
  // Set when linking GitHub fails and the browser comes back here.
  validateSearch: z.object({ github: z.literal('failed').optional().catch(undefined) }),
  component: function SettingsRoute() {
    const { github } = Route.useSearch();
    return <SettingsPage githubFailed={github === 'failed'} />;
  },
});
