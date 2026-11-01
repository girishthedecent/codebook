import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { keys } from '@/api/queries/keys';
import { patchSourceInCache } from '@/api/queries/sources';
import { isAbortError, streamSourceProgress } from '@/api/sse';
import type { Source } from '@/api/types';

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** True while the tab is in front; streams pause when it isn't. */
export function usePageVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  );
}

const RETRY_MS = 5_000;

/**
 * Follows one source's ingest over SSE while `enabled` and the tab is visible, writing each
 * update into the cache so every list and header showing it moves together. A dropped stream
 * refetches the source and reconnects after a pause. Only the detail page uses it.
 */
export function useProgressStream(workspaceId: string, sourceId: string, enabled: boolean) {
  const client = useQueryClient();
  const visible = usePageVisible();
  const active = enabled && visible;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      void client.invalidateQueries({ queryKey: keys.source(sourceId) });
      void client.invalidateQueries({ queryKey: keys.sources(workspaceId) });
      void client.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
    };

    const follow = async () => {
      try {
        for await (const event of streamSourceProgress(sourceId, controller.signal)) {
          if (event.event === 'error') throw new Error(event.data.message);
          if (event.event === 'deleted') {
            client.removeQueries({ queryKey: keys.source(sourceId) });
            refresh();
            return;
          }
          const { status, stage, progress, error } = event.data;
          const before = client.getQueryData<Source>(keys.source(sourceId));
          patchSourceInCache(client, workspaceId, sourceId, { status, stage, progress, error });
          // The stream opens with the current state, which isn't news. Only a change counts as
          // activity, so a run that has gone quiet still reads as stuck after a reconnect.
          const moved =
            before &&
            (before.status !== status || before.stage !== stage || before.progress !== progress);
          if (moved) {
            client.setQueryData(
              keys.source(sourceId),
              (old: Source | undefined) => old && { ...old, updatedAt: new Date().toISOString() },
            );
          }
          if (event.event === 'done' || event.event === 'failed') {
            // Stats and counts only arrive with the full source.
            refresh();
            return;
          }
        }
      } catch (error) {
        if (isAbortError(error)) return;
        refresh();
        // Gone or not ours: the refetch above shows why, and retrying would only repeat it.
        if (isApiError(error) && error.status >= 400 && error.status < 500) return;
        retry = setTimeout(() => void follow(), RETRY_MS);
      }
    };

    void follow();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [active, client, sourceId, workspaceId]);
}
