import { useEffect, useEffectEvent, useRef } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { Source, SourceStatus } from '@/api/types';
import { toast } from '@/ui';
import { nameOf } from './sourceInfo';
import { isIndexing } from './sourceMeta';
import { strings } from './strings';

// One toast per finished run, however many components watch the same list.
const told = new Set<string>();

/**
 * A toast when a source finishes indexing while the reader is somewhere else in the
 * workspace. The library and the source's own page show it already, so they get none. The
 * list it watches is polled only while something is indexing.
 */
export function useIndexingNotices(workspaceId: string, sources: Source[]) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const seen = useRef(new Map<string, SourceStatus>());

  const tell = useEffectEvent((source: Source) => {
    const key = `${source.id}:${source.status}:${source.updatedAt}`;
    if (told.has(key)) return;
    told.add(key);
    const library = `/w/${workspaceId}/sources`;
    const here = pathname.replace(/\/$/, '');
    if (here === library || here === `${library}/${source.id}`) return;
    const { name } = nameOf(source);
    const ready = source.status === 'READY';
    toast({
      kind: ready ? 'ok' : 'error',
      title: ready ? strings.indexed.ready(name) : strings.indexed.failed(name),
      description: ready ? strings.indexed.readyBody : undefined,
      action: {
        label: strings.indexed.open,
        onClick: () =>
          void navigate({
            to: '/w/$workspaceId/sources/$sourceId',
            params: { workspaceId, sourceId: source.id },
          }),
      },
    });
  });

  useEffect(() => {
    const before = seen.current;
    for (const source of sources) {
      const was = before.get(source.id);
      if (was && isIndexing(was) && !isIndexing(source.status)) tell(source);
      before.set(source.id, source.status);
    }
  }, [sources]);
}
