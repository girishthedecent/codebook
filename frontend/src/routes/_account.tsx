import { createFileRoute } from '@tanstack/react-router';
import { requireUser } from '@/auth';
import { AccountLayout } from '@/features/account/AccountLayout';

// Pathless layout for /memory, /usage and /settings: signed-in users (guests included).
export const Route = createFileRoute('/_account')({
  beforeLoad: requireUser,
  component: AccountLayout,
});
