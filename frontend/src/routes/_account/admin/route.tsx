import { createFileRoute } from '@tanstack/react-router';
import { requireAdmin } from '@/auth';
import { AdminLayout } from '@/features/admin/AdminLayout';

// Admin pages don't exist for anyone else: the guard throws the same 404 the backend gives.
export const Route = createFileRoute('/_account/admin')({
  beforeLoad: requireAdmin,
  component: AdminLayout,
});
