import { useSyncExternalStore } from 'react';
import { queryClient } from '@/api/queryClient';
import { isApiError } from '@/api/client';

// Whether the API answered last time we asked. A failed request with no response (status 0)
// flips it off; any request that gets an answer, or the browser coming back online, flips it on.
let reachable = true;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === reachable) return;
  reachable = next;
  for (const l of listeners) l();
}

let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  const seen = (error: unknown, ok: boolean) => {
    if (ok || (isApiError(error) && error.status > 0)) set(true);
    else if (isApiError(error)) set(false);
  };
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    if (event.action.type === 'success') seen(null, true);
    if (event.action.type === 'error') seen(event.action.error, false);
  });
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    if (event.action.type === 'success') seen(null, true);
    if (event.action.type === 'error') seen(event.action.error, false);
  });
  window.addEventListener('online', () => set(true));
}

function subscribe(onChange: () => void) {
  watch();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** True when the browser is offline or the last request never reached the server. */
export function useUnreachable() {
  const api = useSyncExternalStore(
    subscribe,
    () => reachable,
    () => true,
  );
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  return { offline: !online, down: online && !api };
}

/** Retries whatever failed, so the page fills in without a reload. */
export function retryFailed() {
  set(true);
  void queryClient.refetchQueries({ predicate: (q) => q.state.status === 'error' });
}
