import { CaretRight } from '@phosphor-icons/react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Citation } from '@/api/types';
import { citationDestination, citationLabel } from '@/features/citations/citationTarget';
import { useSourceDeleted } from '@/features/citations/useSourceDeleted';
import { cn } from '@/lib/cn';
import { viewerSearchFor } from '@/lib/viewerParams';
import { chat } from './strings';

/**
 * The verified citations under an answer, one row each, in citation order. Same destinations
 * as the chips in the text, for readers who'd rather scan a list.
 */
export function CitedSources({
  citations,
  messageId,
}: {
  citations: Citation[];
  messageId?: string;
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { cite?: number; from?: string };
  const valid = citations.filter((c) => c.valid).sort((a, b) => a.n - b.n);
  if (valid.length === 0) return null;

  const open = (c: Citation) => {
    const dest = citationDestination(c);
    if (dest.kind === 'viewer') {
      void navigate({
        to: '.',
        search: (s: Record<string, unknown>) => ({
          ...s,
          ...viewerSearchFor(dest.target, c.n, messageId),
        }),
      });
    } else if (dest.kind === 'external') {
      window.open(dest.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <details className="group mt-5 border-t border-rule pt-1">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-3 select-none hover:text-ink max-[719px]:min-h-11 [&::-webkit-details-marker]:hidden">
        <CaretRight
          size={10}
          weight="bold"
          aria-hidden
          className="transition-transform duration-150 group-open:rotate-90"
        />
        {chat.sources}
        <span className="font-mono tabular-nums">{valid.length}</span>
      </summary>
      <ol className="mt-1 pb-1">
        {valid.map((c) => (
          <li key={c.n}>
            <SourceRow
              citation={c}
              lit={search.cite === c.n && search.from === messageId}
              onOpen={() => open(c)}
            />
          </li>
        ))}
      </ol>
    </details>
  );
}

function SourceRow({
  citation: c,
  lit,
  onOpen,
}: {
  citation: Citation;
  lit: boolean;
  onOpen: () => void;
}) {
  const dest = citationDestination(c);
  const deleted = useSourceDeleted(dest.kind === 'viewer' ? c.sourceId : undefined);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={dest.kind === 'none' || deleted}
      title={deleted ? 'This source was deleted' : undefined}
      className={cn(
        '-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-baseline gap-2.5 rounded-xs px-1.5 py-1 text-left text-xs hover:bg-paper-2 disabled:cursor-default disabled:hover:bg-transparent max-[719px]:min-h-11 max-[719px]:items-center',
        lit && !deleted && 'bg-accent-wash',
      )}
    >
      <span
        className={cn(
          'w-4 shrink-0 text-right font-medium tabular-nums',
          deleted ? 'text-ink-3 line-through' : 'text-accent',
        )}
      >
        {c.n}
      </span>
      <span
        className={cn(
          'min-w-0 truncate font-mono',
          deleted ? 'text-ink-3 line-through' : 'text-ink-2',
        )}
      >
        {citationLabel(c)}
      </span>
    </button>
  );
}
