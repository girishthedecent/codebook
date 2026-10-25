import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { keys } from '@/api/queries/keys';
import { queryClient } from '@/api/queryClient';
import { signInHref } from '@/auth/guards';
import { toast } from '@/ui';

// Pages that work without a session; a 401 there means nothing.
const open = ['/', '/sign-in', '/demo'];

/**
 * A 401 on any request while the app thinks someone is signed in means the session ended
 * (expired, or revoked elsewhere). Drop the cached identity and send them to sign in, coming
 * back to the same page afterwards.
 */
export function useSessionExpiry() {
  const router = useRouter();
  useEffect(() => {
    let handling = false;
    const onError = (error: unknown) => {
      if (handling || !isApiError(error, 401)) return;
      if (!queryClient.getQueryData(keys.me)) return;
      const { pathname, href } = router.state.location;
      if (open.includes(pathname)) return;
      handling = true;
      queryClient.setQueryData(keys.me, null);
      toast({ title: 'Your session ended. Sign in to continue.', kind: 'info' });
      void router.navigate({ href: signInHref(href), replace: true }).finally(() => {
        handling = false;
      });
    };
    const offQueries = queryClient.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'error') onError(e.action.error);
    });
    const offMutations = queryClient.getMutationCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'error') onError(e.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [router]);
}
