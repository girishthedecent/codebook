import { useInfiniteQuery } from '@tanstack/react-query';
import { useDemo } from '@/api/queries/demo';
import { flatItems } from '@/api/queries/keys';
import { sourcesQueryOptions } from '@/api/queries/sources';
import type { Source } from '@/api/types';

/**
 * What a workspace holds. The demo's sources come with the demo payload, so a visitor never
 * asks for a list they can't have; everyone else reads the workspace's own list. `known` is
 * false until the answer is in, so a screen can wait instead of flashing "nothing here".
 */
export function useWorkspaceSources(workspaceId: string): { sources: Source[]; known: boolean } {
  const demo = useDemo();
  const inDemo = demo.data?.workspace.id === workspaceId;
  const list = useInfiniteQuery({
    ...sourcesQueryOptions(workspaceId),
    enabled: !demo.isPending && !inDemo,
  });
  if (inDemo && demo.data) return { sources: demo.data.sources, known: true };
  return { sources: flatItems(list.data), known: list.isSuccess };
}
