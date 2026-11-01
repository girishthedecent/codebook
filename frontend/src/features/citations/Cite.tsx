import { useSearch } from '@tanstack/react-router';
import type { Citation } from '@/api/types';
import { Button, Popover, PopoverClose, Tooltip } from '@/ui';
import { cn } from '@/lib/cn';
import { citationCaption, citationDestination, citationLabel } from './citationTarget';
import { useOpenCitation } from './openCitation';
import { citationStrings as t } from './strings';
import { useSourceDeleted } from './useSourceDeleted';
import { useTouch } from './useTouch';

/** Why a reference can't be taken at face value, in a sentence; empty when it can. */
export function citationCaveat(citation: Citation, deleted: boolean): string {
  if (deleted) return t.deleted;
  if (!citation.valid) return t.unverified;
  if (citation.supported === false) return t.unsupported;
  return '';
}

/**
 * A citation marker: a small superscript number in the accent colour. Hovering shows the
 * passage and where it is from; on a touch screen a tap does the same in a popover with an
 * Open button. Clicking opens the viewer there and keeps the chip lit while it's open. Chips
 * whose reference is unverified, unsupported or deleted are marked, and say why when asked.
 */
export function Cite({
  citation,
  shown = citation.n,
  messageId,
}: {
  citation: Citation;
  /** The number the reader sees; the registry number stays in the address. */
  shown?: number;
  messageId?: string;
}) {
  const touch = useTouch();
  const search = useSearch({ strict: false }) as { cite?: number; from?: string };
  const open = useOpenCitation(messageId);
  const dest = citationDestination(citation);
  const deleted = useSourceDeleted(dest.kind === 'viewer' ? citation.sourceId : undefined);
  // Numbers restart each answer, so a chip is lit only in the answer it was opened from.
  const lit = search.cite === citation.n && search.from === messageId;
  const label = citationLabel(citation);
  const caveat = citationCaveat(citation, deleted);
  const openable = dest.kind !== 'none' && !deleted;

  const preview = (
    <span className="block max-w-[320px]">
      <span className="block text-xs text-ink-3">
        {citation.valid ? citationCaption(citation) : ''}
      </span>
      {citation.valid && citation.snippet && (
        <span className="mt-1 block font-serif text-sm text-ink">{citation.snippet}</span>
      )}
      {caveat && <span className="mt-1.5 block text-xs text-warn">{caveat}</span>}
    </span>
  );

  const chip = (
    <button
      type="button"
      onClick={touch ? undefined : () => open(citation)}
      disabled={!touch && !openable}
      data-cite={citation.n}
      aria-label={
        deleted
          ? `Note ${shown}: ${label}, deleted`
          : citation.valid
            ? `Note ${shown}: ${label}`
            : `Note ${shown}, not verified`
      }
      aria-pressed={dest.kind === 'viewer' && !deleted && !touch ? lit : undefined}
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
      {shown}
    </button>
  );

  if (!touch) return <Tooltip content={preview}>{chip}</Tooltip>;
  return (
    <Popover trigger={chip} side="top" align="center">
      {preview}
      {openable && (
        <PopoverClose asChild>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => open(citation)}>
            {dest.kind === 'external' ? t.openPage : t.open}
          </Button>
        </PopoverClose>
      )}
    </Popover>
  );
}
