import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Citation } from '@/api/types';
import { citationDestination, citationLabel } from '@/features/citations/citationTarget';
import { cn } from '@/lib/cn';
import { viewerSearchFor } from '@/lib/viewerParams';
import { chat } from './strings';

/**
 * The verified citations under an answer, one row each, in citation order. Same destinations
 * as the chips in the text, for readers who'd rather scan a list.
 */
export function CitedSources({ citations }: { citations: Citation[] }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { cite?: number };
  const valid = citations.filter((c) => c.valid).sort((a, b) => a.n - b.n);
  if (valid.length === 0) return null;

  const open = (c: Citation) => {
    const dest = citationDestination(c);
    if (dest.kind === 'viewer') {
      void navigate({
        to: '.',
        search: (s: Record<string, unknown>) => ({ ...s, ...viewerSearchFor(dest.target, c.n) }),
      });
    } else if (dest.kind === 'external') {
      window.open(dest.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="mt-5 border-t border-rule pt-3">
      <h3 className="text-xs font-medium text-ink-3">{chat.sources}</h3>
      <ol className="mt-1.5">
        {valid.map((c) => (
          <li key={c.n}>
            <button
              type="button"
              onClick={() => open(c)}
              className={cn(
                '-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-baseline gap-2.5 rounded-xs px-1.5 py-1 text-left text-xs hover:bg-paper-2 max-[719px]:min-h-11 max-[719px]:items-center',
                search.cite === c.n && 'bg-accent-wash',
              )}
            >
              <span className="w-4 shrink-0 text-right font-medium text-accent tabular-nums">
                {c.n}
              </span>
              <span className="min-w-0 truncate font-mono text-ink-2">{citationLabel(c)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
