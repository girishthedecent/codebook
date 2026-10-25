import type { Citation } from '@/api/types';
import { Cite } from '@/features/citations/Cite';

/** The chips after a sentence or item. Renders nothing for uncited items. */
export function Cites({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <span className="whitespace-nowrap">
      {citations.map((c) => (
        <Cite key={c.n} citation={c} />
      ))}
    </span>
  );
}
