import { useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { useSearch } from '@tanstack/react-router';
import { Button, TextButton } from '@/ui';
import { cn } from '@/lib/cn';
import { citationCaption, citationDestination } from './citationTarget';
import { citationCaveat } from './Cite';
import type { Note } from './numbering';
import { useOpenCitation } from './openCitation';
import { citationStrings as t } from './strings';
import { useSourceDeleted } from './useSourceDeleted';

/**
 * The passages an answer rests on, numbered as its markers are, each with the sentence from the
 * source, where it comes from and a way to open it. Shown by default: the answer is only as
 * good as these, and a reader shouldn't have to hunt for them.
 */
export function Notes({ notes, messageId }: { notes: Note[]; messageId?: string }) {
  const [open, setOpen] = useState(true);
  if (notes.length === 0) return null;
  return (
    <section aria-label={t.notes} className="mt-6">
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-label={open ? t.hide : t.show}
        onClick={() => setOpen((o) => !o)}
        className="-ml-2.5 gap-1.5 font-serif font-semibold"
      >
        <CaretRight
          size={12}
          weight="bold"
          aria-hidden
          className={cn('transition-transform duration-150', open && 'rotate-90')}
        />
        {t.notes}
        <span className="font-normal text-ink-3">{notes.length}</span>
      </Button>
      {open && (
        <ol className="mt-1 space-y-4">
          {notes.map((note) => (
            <NoteRow key={note.citation.n} note={note} messageId={messageId} />
          ))}
        </ol>
      )}
    </section>
  );
}

function NoteRow({ note: { citation, shown }, messageId }: { note: Note; messageId?: string }) {
  const search = useSearch({ strict: false }) as { cite?: number; from?: string };
  const open = useOpenCitation(messageId);
  const dest = citationDestination(citation);
  const deleted = useSourceDeleted(dest.kind === 'viewer' ? citation.sourceId : undefined);
  const lit = search.cite === citation.n && search.from === messageId && !deleted;
  const caveat = citationCaveat(citation, deleted);
  const openable = dest.kind !== 'none' && !deleted;
  return (
    <li className={cn('flex gap-3 rounded-sm py-1', lit && 'bg-accent-wash')}>
      <span
        className={cn(
          'w-5 shrink-0 pt-px text-right font-serif text-base tabular-nums',
          deleted ? 'text-ink-3' : 'text-accent',
        )}
      >
        {shown}
      </span>
      <div className="min-w-0 flex-1">
        {citation.snippet && (
          <p
            className={cn(
              'line-clamp-4 font-serif text-sm text-pretty text-ink-2',
              deleted && 'text-ink-3',
            )}
          >
            {citation.snippet}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-3">
          <span className={cn('min-w-0 [overflow-wrap:anywhere]', deleted && 'line-through')}>
            {citationCaption(citation)}
          </span>
          {openable && (
            <TextButton onClick={() => open(citation)} className="py-2.5 max-sm:py-3">
              {dest.kind === 'external' ? t.openPage : t.open}
            </TextButton>
          )}
        </p>
        {caveat && <p className="text-xs text-warn">{caveat}</p>}
      </div>
    </li>
  );
}
