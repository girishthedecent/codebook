import { useSearch } from '@tanstack/react-router';
import { cn } from '@/lib/cn';
import { citationCaption, citationDestination } from './citationTarget';
import type { Note } from './numbering';
import { useOpenCitation } from './openCitation';
import { citationStrings as t } from './strings';
import { useSourceDeleted } from './useSourceDeleted';

/**
 * The notes for one paragraph, set in the right margin beside it. They repeat what the Notes
 * list under the answer says, so they are hidden from assistive technology; the markers in the
 * text and that list are how the same passages are reached without a pointer.
 */
export function MarginNotes({
  notes,
  messageId,
  className,
}: {
  notes: Note[];
  messageId?: string;
  className?: string;
}) {
  return (
    <aside aria-hidden className={cn('space-y-2.5 self-start pt-1', className)}>
      {notes.map((note) => (
        <MarginNote key={note.citation.n} note={note} messageId={messageId} />
      ))}
    </aside>
  );
}

function MarginNote({ note: { citation, shown }, messageId }: { note: Note; messageId?: string }) {
  const search = useSearch({ strict: false }) as { cite?: number; from?: string };
  const open = useOpenCitation(messageId);
  const dest = citationDestination(citation);
  const deleted = useSourceDeleted(dest.kind === 'viewer' ? citation.sourceId : undefined);
  const lit = search.cite === citation.n && search.from === messageId && !deleted;
  const openable = dest.kind !== 'none' && !deleted;
  return (
    // A mouse shortcut only: the margin is hidden from assistive tech, and the Notes list under
    // the answer has the same notes as real links.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      onClick={openable ? () => open(citation) : undefined}
      title={openable ? (dest.kind === 'external' ? t.openPage : t.open) : undefined}
      className={cn(
        'flex gap-2 rounded-sm text-xs leading-snug',
        openable && 'cursor-pointer hover:bg-accent-wash',
        lit && 'bg-accent-wash',
      )}
    >
      <span
        className={cn(
          'w-4 shrink-0 text-right font-serif [font-variant-numeric:lining-nums_tabular-nums]',
          deleted ? 'text-ink-3' : 'text-accent',
        )}
      >
        {shown}
      </span>
      <div className="min-w-0 flex-1">
        {citation.snippet && (
          <p
            className={cn(
              'line-clamp-3 font-serif text-xs text-pretty text-ink-2',
              deleted && 'text-ink-3',
            )}
          >
            {citation.snippet}
          </p>
        )}
        <p
          className={cn(
            'mt-0.5 font-sans text-ink-3 [overflow-wrap:anywhere]',
            deleted && 'line-through',
          )}
        >
          {citationCaption(citation)}
        </p>
      </div>
    </div>
  );
}
