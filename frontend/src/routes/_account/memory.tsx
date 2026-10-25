import { createFileRoute } from '@tanstack/react-router';
import { forbidGuest } from '@/auth';
import { MemoryPage } from '@/features/memory/MemoryPage';

export const Route = createFileRoute('/_account/memory')({
  beforeLoad: forbidGuest,
  component: MemoryPage,
});
