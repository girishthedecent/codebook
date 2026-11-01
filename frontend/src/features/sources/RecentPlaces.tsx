import type { Source } from '@/api/types';
import { SourceBadge } from '@/ui';
import { placeLabel, useRecentPlaces } from './recent';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';

/** The last few places read on this device, each opening the viewer where the reader left off. */
export function RecentPlaces({ workspaceId, sources }: { workspaceId: string; sources: Source[] }) {
  const openInViewer = useOpenInViewer();
  const places = useRecentPlaces(workspaceId).filter((p) =>
    sources.some((s) => s.id === p.sourceId),
  );
  if (!places.length) return null;

  return (
    <section aria-labelledby="recent" className="mb-8">
      <h2 id="recent" className="heading-minor mb-2 text-ink">
        {strings.library.recent}
      </h2>
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {places.map((place) => {
          const where = placeLabel(place);
          return (
            <li key={place.sourceId} className="w-52 shrink-0 snap-start">
              <button
                type="button"
                aria-label={strings.library.recentOpen(place.title, where)}
                onClick={() => openInViewer(place.target)}
                className="flex min-h-14 w-full items-start gap-2.5 rounded-md bg-paper-2 px-3 py-2.5 text-left shadow-[0_0_0_1px_var(--rule)] transition-colors duration-150 hover:bg-paper-3"
              >
                <SourceBadge type={place.type} />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{place.title}</span>
                  <span className="block truncate font-serif text-sm text-ink-3 italic oldstyle-nums">
                    {where}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
