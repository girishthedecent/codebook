import { useQuery } from '@tanstack/react-query';
import { meQueryOptions } from '@/api/queries/me';
import type { Me } from '@/api/types';

export type MeState = {
  me: Me | null;
  isSignedIn: boolean;
  isGuest: boolean;
  isAdmin: boolean;
  isLoading: boolean;
};

/** Who is using the app. Guests are anonymous better-auth users with `isGuest` set by the backend. */
export function useMe(): MeState {
  const query = useQuery(meQueryOptions);
  const me = query.data ?? null;
  return {
    me,
    isSignedIn: me !== null,
    isGuest: me?.isGuest ?? false,
    isAdmin: me?.isAdmin ?? false,
    isLoading: query.isPending,
  };
}
