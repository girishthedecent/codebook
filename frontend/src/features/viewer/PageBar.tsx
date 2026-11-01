import { useState } from 'react';
import { CaretLeft, CaretRight, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { Button } from '@/ui';
import { s } from './strings';

/** `fit` fills the pane's width, `page` shows the whole page; the numbers are print sizes. */
export type Zoom = 'fit' | 'page' | 1 | 1.5;

export const zooms: Array<{ value: Zoom; label: string; short: string }> = [
  { value: 'page', label: s.fitPage, short: s.fitPageShort },
  { value: 'fit', label: s.fitWidth, short: s.fitWidthShort },
  { value: 1, label: '100%', short: '100%' },
  { value: 1.5, label: '150%', short: '150%' },
];

/**
 * Page input, previous/next, and zoom when the real page is shown. On a phone the bar is
 * "‹ 12 / 189 ›" with one zoom button that steps through the sizes.
 */
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
  const current = zooms.findIndex((z) => z.value === zoom);

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-rule px-2 py-1 text-xs text-ink-2">
      <Button
        variant="ghost"
        size="sm"
        aria-label={s.prevPage}
        disabled={page <= 1}
        onClick={() => onGo(page - 1)}
      >
        <CaretLeft size={14} aria-hidden />
      </Button>
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
          className="h-8 w-12 rounded-xs border border-edge bg-paper text-center font-serif text-sm oldstyle-nums max-sm:h-11 max-sm:w-14 max-sm:text-base"
        />
        {pageCount && (
          <span className="font-serif text-sm oldstyle-nums">
            <span aria-hidden className="sm:hidden">
              / {pageCount}
            </span>
            <span className="max-sm:sr-only">
              {s.of} {pageCount}
            </span>
          </span>
        )}
      </form>
      <Button
        variant="ghost"
        size="sm"
        aria-label={s.nextPage}
        disabled={pageCount !== undefined && page >= pageCount}
        onClick={() => onGo(page + 1)}
      >
        <CaretRight size={14} aria-hidden />
      </Button>
      {zoom !== undefined && onZoom && (
        <>
          <div role="group" aria-label={s.zoom} className="ml-auto flex items-center max-sm:hidden">
            {zooms.map((z) => (
              <button
                key={String(z.value)}
                type="button"
                aria-pressed={zoom === z.value}
                onClick={() => onZoom(z.value)}
                className={cn(
                  'h-8 rounded-xs px-2 hover:bg-paper-2',
                  zoom === z.value ? 'font-medium text-ink' : 'text-ink-3',
                )}
              >
                {z.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto sm:hidden"
            aria-label={`${s.zoom}: ${zooms[current]?.label}`}
            onClick={() => onZoom(zooms[(current + 1) % zooms.length]!.value)}
          >
            <MagnifyingGlassPlus size={16} aria-hidden />
            {zooms[current]?.short}
          </Button>
        </>
      )}
    </div>
  );
}
