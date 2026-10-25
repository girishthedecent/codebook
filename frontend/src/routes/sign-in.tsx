import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { meQueryOptions } from '@/api/queries/me';
import { SignInPage } from '@/features/auth/SignInPage';
import { safeNext } from '@/features/auth/safeNext';

const searchSchema = z.object({
  next: z.string().optional(),
  reason: z.enum(['guest']).optional(),
  // Set by better-auth when the GitHub round trip fails; only its presence matters.
  error: z.string().optional(),
});

export const Route = createFileRoute('/sign-in')({
  validateSearch: searchSchema,
  // Someone already signed in has nothing to do here. Guests stay: signing in links their session.
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (me && !me.isGuest) throw redirect({ href: safeNext(search.next) });
  },
  component: SignInRoute,
});

function SignInRoute() {
  const { next, reason, error } = Route.useSearch();
  return <SignInPage next={next} reason={reason} oauthFailed={Boolean(error)} />;
}
