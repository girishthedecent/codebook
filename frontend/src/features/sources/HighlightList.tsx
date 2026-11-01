import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  HIGHLIGHT_NOTE_MAX,
  useDeleteHighlight,
  useHighlights,
  useUpdateHighlight,
  type Highlight,
} from '@/api/queries/highlights';
import { flatItems } from '@/api/queries/keys';
import { cn } from '@/lib/cn';
import { Button, Callout, Field, SectionHeading, Skeleton, TextButton, Textarea } from '@/ui';
import { highlightPlace, highlightTarget } from './highlightPlace';
import { shortDate } from './sourceInfo';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';
import '@/features/viewer/marks.css';

const h = strings.highlights;

/**
 * One highlight: the passage in the marker's tint, where it is (which opens the viewer there),
 * the note under it, and ways to write the note or drop the highlight.
 */
export function HighlightItem({
  highlight,
  workspaceId,
}: {
  highlight: Highlight;
  workspaceId: string;
}) {
  const openInViewer = useOpenInViewer();
  const update = useUpdateHighlight(workspaceId);
  const remove = useDeleteHighlight(workspaceId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const place = highlightPlace(highlight);

  const startEditing = () => {
    update.reset();
    setEditing(true);
  };
  // Back to the button that opened the note, so the keyboard keeps its place.
  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };

  return (
    <li>
      <blockquote className="font-serif text-base text-ink">
        <p className="line-clamp-6">
          <span className="bg-(--mark) px-0.5 [box-decoration-break:clone]">{highlight.text}</span>
        </p>
      </blockquote>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
        <TextButton
          className={cn('text-left max-sm:py-2', place.mono && 'font-mono')}
          aria-label={h.open(place.text)}
          onClick={() => openInViewer(highlightTarget(highlight))}
        >
          {place.text}
        </TextButton>
        <span aria-hidden>·</span>
        <time dateTime={highlight.createdAt}>{shortDate(highlight.createdAt)}</time>
      </p>

      {editing ? (
        <NoteForm
          initial={highlight.note ?? ''}
          saving={update.isPending}
          error={update.error}
          onSave={(note) =>
            update.mutate(
              { highlightId: highlight.id, note: note || null },
              { onSuccess: stopEditing },
            )
          }
          onCancel={stopEditing}
        />
      ) : (
        highlight.note && (
          <p className="mt-2 max-w-prose font-serif text-sm text-ink-2 italic">{highlight.note}</p>
        )
      )}

      {!editing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 text-xs">
          {confirming ? (
            <span role="group" aria-label={h.confirmDelete} className="flex items-center gap-2">
              <span className="text-ink-2">{h.confirmDelete}</span>
              <Button
                variant="danger"
                size="sm"
                loading={remove.isPending}
                onClick={() => remove.mutate(highlight.id)}
              >
                {h.delete}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                {h.keep}
              </Button>
            </span>
          ) : (
            <>
              <TextButton ref={editButton} className="py-1 max-sm:py-2.5" onClick={startEditing}>
                {highlight.note ? h.editNote : h.addNote}
              </TextButton>
              <TextButton
                className="py-1 text-ink-3 max-sm:py-2.5"
                onClick={() => setConfirming(true)}
              >
                {h.delete}
              </TextButton>
            </>
          )}
        </div>
      )}
      {remove.error && <Callout error={remove.error} className="mt-2" />}
    </li>
  );
}

function NoteForm({
  initial,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  error: Error | null;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(draft.trim());
  };

  return (
    <form onSubmit={submit} className="mt-3 max-w-prose space-y-2">
      <Field label={h.noteLabel} hint={h.noteHint(HIGHLIGHT_NOTE_MAX)}>
        <Textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={HIGHLIGHT_NOTE_MAX}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
        />
      </Field>
      {error && <Callout error={error} />}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {h.save}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {h.cancel}
        </Button>
      </div>
    </form>
  );
}

/** The highlights section of a source's page. */
export function SourceHighlights({
  workspaceId,
  sourceId,
}: {
  workspaceId: string;
  sourceId: string;
}) {
  const query = useHighlights(workspaceId, sourceId);
  const items = flatItems(query.data);

  return (
    <section aria-labelledby="highlights" className="mt-10">
      <SectionHeading id="highlights" hint={items.length ? undefined : h.sectionHint}>
        {h.section}
      </SectionHeading>
      {query.isPending ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">{h.loading}</span>
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : query.isError && !items.length ? (
        <Callout error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        items.length > 0 && (
          <>
            <ul className="space-y-7">
              {items.map((item) => (
                <HighlightItem key={item.id} highlight={item} workspaceId={workspaceId} />
              ))}
            </ul>
            {query.hasNextPage && (
              <Button
                variant="ghost"
                className="mt-2"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {strings.loadMore}
              </Button>
            )}
          </>
        )
      )}
    </section>
  );
}
