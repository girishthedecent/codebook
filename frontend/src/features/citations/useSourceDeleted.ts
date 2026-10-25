import { useParams } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDemo } from '@/api/queries/demo';
import { flatItems } from '@/api/queries/keys';
import { sourcesQueryOptions } from '@/api/queries/sources';

/**
 * Whether a cited source no longer exists in the workspace. Reads the sources list the sidebar
 * already caches, so chips cost no request of their own. Only answers yes once that list has
 * loaded in full and lacks the id; until then, and on any error, the chip stays as it was.
 * The demo workspace's sources come from the demo payload, since visitors can't list them.
 */
export function useSourceDeleted(sourceId: string | undefined): boolean {
  const { workspaceId = '' } = useParams({ strict: false });
  const demo = useDemo();
  const isDemo = demo.data?.workspace.id === workspaceId;
  const list = useInfiniteQuery({
    ...sourcesQueryOptions(workspaceId),
    // Wait for the demo check so a visitor never fires a request they can't make.
    enabled: !!workspaceId && !demo.isPending && !isDemo,
  });

  if (!sourceId || !workspaceId) return false;
  if (isDemo) return !!demo.data && !demo.data.sources.some((src) => src.id === sourceId);
  if (!list.isSuccess || list.hasNextPage) return false;
  return !flatItems(list.data).some((src) => src.id === sourceId);
}
