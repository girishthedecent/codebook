import { createFileRoute } from '@tanstack/react-router';
import { Landing } from '@/features/landing/Landing';

export const Route = createFileRoute('/')({
  component: Landing,
});
