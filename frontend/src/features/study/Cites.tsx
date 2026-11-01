import type { Citation } from '@/api/types';
import { Cite } from '@/features/citations/Cite';
import { s } from './strings';

/**
 * The chips after a sentence or item. An item the set couldn't tie to a passage says so
 * quietly; one that has none renders nothing.
 */
export function Cites({ citations, uncited }: { citations: Citation[]; uncited?: boolean }) {
  if (citations.length === 0) {
    return uncited ? (
      <span title={s.noSourceHint} className="text-xs whitespace-nowrap text-ink-3 italic">
        {s.noSource}
      </span>
    ) : null;
  }
  return (
    <span className="whitespace-nowrap">
      {citations.map((c) => (
        <Cite key={c.n} citation={c} />
      ))}
    </span>
  );
}
