import { useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { s } from './strings';

export type Zoom = 'fit' | 1 | 1.5;

const zooms: Array<{ value: Zoom; label: string }> = [
  { value: 'fit', label: s.fitWidth },
  { value: 1, label: '100%' },
  { value: 1.5, label: '150%' },
];

/** Page input, previous/next, and zoom when the real page is shown. */
export function PageBar({
  page,
  pageCount,
  onGo,
  zoom,
  onZoom,
}: {
  page: number;
  pageCount?: number;
  onGo: (page: number) => void;
  zoom?: Zoom;
  onZoom?: (zoom: Zoom) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const iconButton =
    'flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-40 max-[719px]:size-11';

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b max-[719px]:h-12 border-rule px-2 text-xs text-ink-2">
      <button
        type="button"
        className={iconButton}
        aria-label={s.prevPage}
        disabled={page <= 1}
        onClick={() => onGo(page - 1)}
      >
        <CaretLeft size={14} />
      </button>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(draft);
          if (Number.isInteger(n) && n > 0) onGo(n);
          setDraft(null);
        }}
      >
        <label htmlFor="viewer-page" className="sr-only">
          {s.page}
        </label>
        <input
          id="viewer-page"
          inputMode="numeric"
          value={draft ?? String(page)}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
          onBlur={() => setDraft(null)}
          className="h-7 w-12 max-[719px]:h-10 rounded-xs border border-rule-2 bg-paper text-center font-serif text-sm [font-variant-numeric:oldstyle-nums]"
        />
        {pageCount && (
          <span className="font-serif text-sm [font-variant-numeric:oldstyle-nums]">
            {s.of} {pageCount}
          </span>
        )}
      </form>
      <button
        type="button"
        className={iconButton}
        aria-label={s.nextPage}
        disabled={pageCount !== undefined && page >= pageCount}
        onClick={() => onGo(page + 1)}
      >
        <CaretRight size={14} />
      </button>
      {zoom !== undefined && onZoom && (
        <div role="group" aria-label={s.zoom} className="ml-auto flex items-center">
          {zooms.map((z) => (
            <button
              key={String(z.value)}
              type="button"
              aria-pressed={zoom === z.value}
              onClick={() => onZoom(z.value)}
              className={cn(
                'h-7 rounded-xs px-2 hover:bg-paper-2 max-[719px]:h-10 max-[719px]:px-2.5',
                zoom === z.value ? 'font-medium text-ink' : 'text-ink-3',
              )}
            >
              {z.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
