import { createFileRoute } from '@tanstack/react-router';
import { DemoEntry } from '@/features/auth/DemoEntry';

export const Route = createFileRoute('/demo')({
  component: DemoEntry,
});
