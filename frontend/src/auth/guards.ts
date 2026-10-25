import { notFound, redirect } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { meQueryOptions } from '@/api/queries/me';
import type { Me } from '@/api/types';

/** The parts of a route's `beforeLoad` argument the guards read. */
export type GuardArgs = {
  context: { queryClient: QueryClient };
  location: { href: string };
};

/** The sign-in page's address, with the route to come back to. */
export function signInHref(next: string, reason?: 'guest') {
  const params = new URLSearchParams({ next });
  if (reason) params.set('reason', reason);
  return `/sign-in?${params.toString()}`;
}

/** For `beforeLoad`: a session is required; otherwise go to sign-in and come back after. */
export async function requireUser({ context, location }: GuardArgs): Promise<{ me: Me }> {
  const me = await context.queryClient.ensureQueryData(meQueryOptions);
  if (!me) throw redirect({ href: signInHref(location.href) });
  return { me };
}

/** For routes guests can't use (memory, settings): the sign-in page explains why. */
export async function forbidGuest(args: GuardArgs): Promise<{ me: Me }> {
  const result = await requireUser(args);
  if (result.me.isGuest) throw redirect({ href: signInHref(args.location.href, 'guest') });
  return result;
}

/** Admin routes don't exist for anyone else, same as the backend's 404. */
export async function requireAdmin(args: GuardArgs): Promise<{ me: Me }> {
  const result = await requireUser(args);
  if (!result.me.isAdmin) throw notFound();
  return result;
}
