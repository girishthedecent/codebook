import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Citation } from '@/api/types';
import { Tooltip } from '@/ui';
import { cn } from '@/lib/cn';
import { viewerSearchFor } from '@/lib/viewerParams';
import { citationDestination, citationLabel } from './citationTarget';
import { useSourceDeleted } from './useSourceDeleted';

/**
 * A citation marker: a superscript number in the accent color. Hover shows the snippet and
 * where it's from; click opens the viewer there and keeps the chip lit while it's open.
 * Invalid references are struck through, unsupported ones hollow; so are chips whose source
 * has since been deleted, which can't be opened.
 */
export function Cite({ citation, messageId }: { citation: Citation; messageId?: string }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { cite?: number; from?: string };
  const dest = citationDestination(citation);
  const deleted = useSourceDeleted(dest.kind === 'viewer' ? citation.sourceId : undefined);
  // Numbers restart each answer, so a chip is lit only in the answer it was opened from.
  const lit = search.cite === citation.n && search.from === messageId;
  const label = citationLabel(citation);

  const open = () => {
    if (dest.kind === 'viewer') {
      void navigate({
        to: '.',
        search: (s: Record<string, unknown>) => ({
          ...s,
          ...viewerSearchFor(dest.target, citation.n, messageId),
        }),
      });
    } else if (dest.kind === 'external') {
      window.open(dest.url, '_blank', 'noopener,noreferrer');
    }
  };

  const tip = deleted ? (
    'This source was deleted'
  ) : citation.valid ? (
    <span className="block max-w-[320px]">
      <span className="block font-mono text-xs text-ink-3">{label}</span>
      {citation.snippet && (
        <span className="mt-1 block font-serif text-sm text-ink">{citation.snippet}</span>
      )}
    </span>
  ) : (
    "This reference couldn't be verified"
  );

  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={open}
        disabled={dest.kind === 'none' || deleted}
        aria-label={
          deleted
            ? `Source ${citation.n}: ${label}, deleted`
            : citation.valid
              ? `Source ${citation.n}: ${label}`
              : `Reference ${citation.n}, not verified`
        }
        aria-pressed={dest.kind === 'viewer' && !deleted ? lit : undefined}
        className={cn(
          'relative mx-px inline-flex min-w-[1.35em] -translate-y-[0.45em] items-center justify-center rounded-full px-1 align-baseline font-sans text-[0.68em] leading-[1.5] font-medium transition-colors duration-150 after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[""]',
          (!citation.valid || deleted) && 'text-ink-3 line-through',
          !deleted &&
            citation.valid &&
            citation.supported === false &&
            'border border-accent text-accent',
          !deleted &&
            citation.valid &&
            citation.supported !== false &&
            !lit &&
            'bg-accent-wash text-accent hover:bg-accent hover:text-paper',
          !deleted && lit && 'bg-accent text-paper',
        )}
      >
        {citation.n}
      </button>
    </Tooltip>
  );
}
