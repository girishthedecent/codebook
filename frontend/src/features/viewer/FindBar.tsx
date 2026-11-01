import { useState, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, CaretUp, MagnifyingGlass, X } from '@phosphor-icons/react';
import { searchQueryOptions } from '@/api/queries/sources';
import type { SearchHit, SourceType } from '@/api/types';
import { Highlight, hitTarget, snippetAround } from '@/features/command/passages';
import { cn } from '@/lib/cn';
import type { ViewerTarget } from '@/lib/viewerParams';
import { Button, Skeleton, TextButton, Tooltip } from '@/ui';
import { s } from './strings';

const t = s.find;

export type FindBarProps = {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  onQuery: (query: string) => void;
  /** 0-based index of the current hit, and how many there are. */
  index: number;
  count: number;
  /** Only part of the view was searched. */
  partial: boolean;
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  placeholder: string;
  /** Searching the rest of a book or site, through the workspace's keyword search. */
  whole?: {
    workspaceId: string;
    sourceId: string;
    sourceType: SourceType;
    onOpen: (target: ViewerTarget) => void;
  };
};

/**
 * Find in what the viewer shows: a field, "3 of 12", and steps through the hits. Enter goes
 * to the next hit and Shift+Enter to the previous one. Books and sites also offer a search of
 * the whole source, which lists the pages that match.
 */
export function FindBar({
  inputRef,
  query,
  onQuery,
  index,
  count,
  partial,
  onStep,
  onClose,
  placeholder,
  whole,
}: FindBarProps) {
  const [wholeQuery, setWholeQuery] = useState<string>();
  const trimmed = query.trim();

  return (
    <div className="shrink-0 border-b border-rule px-2 py-1.5">
      <div role="search" className="flex items-center gap-1">
        <MagnifyingGlass size={14} aria-hidden className="ml-1 shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          }}
          placeholder={placeholder}
          aria-label={t.label}
          aria-keyshortcuts="Enter Shift+Enter"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-xs bg-transparent px-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none max-sm:h-11 max-sm:text-base [&::-webkit-search-cancel-button]:hidden"
        />
        <span
          role="status"
          className="shrink-0 px-1 font-serif text-sm whitespace-nowrap text-ink-2 oldstyle-nums"
        >
          {trimmed ? (count ? t.count((index % count) + 1, count) : t.none) : ''}
        </span>
        <Tooltip content={`${t.prev}  ${s.shiftEnter}`}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t.prev}
            disabled={!count}
            onClick={() => onStep(-1)}
          >
            <CaretUp size={14} aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip content={`${t.next}  ${s.enter}`}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t.next}
            disabled={!count}
            onClick={() => onStep(1)}
          >
            <CaretDown size={14} aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip content={`${t.close}  Esc`}>
          <Button variant="ghost" size="sm" aria-label={t.close} onClick={onClose}>
            <X size={14} aria-hidden />
          </Button>
        </Tooltip>
      </div>
      {partial && trimmed && <p className="px-1.5 pt-0.5 text-xs text-ink-3">{t.partial}</p>}
      {whole && trimmed && (
        <div className="px-1.5 pt-0.5">
          {wholeQuery === trimmed ? (
            <TextButton
              className="py-1 text-xs max-sm:py-2.5"
              onClick={() => setWholeQuery(undefined)}
            >
              {t.hide}
            </TextButton>
          ) : (
            <TextButton
              className="py-1 text-xs max-sm:py-2.5"
              onClick={() => setWholeQuery(trimmed)}
            >
              {whole.sourceType === 'WEBSITE' ? t.wholeSite : t.wholeBook}
            </TextButton>
          )}
          {wholeQuery === trimmed && (
            <WholeResults
              {...whole}
              query={wholeQuery}
              onOpen={(target) => {
                setWholeQuery(undefined);
                whole.onOpen(target);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The places in the source that match, one line each, best first. */
function WholeResults({
  workspaceId,
  sourceId,
  query,
  onOpen,
}: {
  workspaceId: string;
  sourceId: string;
  query: string;
  onOpen: (target: ViewerTarget) => void;
}) {
  const search = useQuery(
    searchQueryOptions(workspaceId, {
      query,
      mode: 'keyword',
      sourceIds: [sourceId],
      topK: 20,
      expandParents: false,
    }),
  );

  if (search.isPending) {
    return (
      <div role="status" className="flex flex-col gap-2 py-2">
        <span className="sr-only">{t.searching}</span>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (search.isError) {
    return (
      <p role="alert" className="py-1 text-xs text-error">
        {search.error.message}{' '}
        <TextButton className="text-xs" onClick={() => void search.refetch()}>
          {s.retry}
        </TextButton>
      </p>
    );
  }
  const places = onePerPlace(search.data.results);
  if (!places.length) return <p className="py-1 text-xs text-ink-3">{t.noHits}</p>;

  return (
    <div className="pb-1">
      <p className="sr-only" role="status">
        {t.hits(places.length)}
      </p>
      <ol className="max-h-[40dvh] overflow-auto">
        {places.map((hit) => (
          <li key={hit.chunkId}>
            <button
              type="button"
              onClick={() => onOpen(hitTarget(hit))}
              className={cn(
                'flex w-full rounded-sm px-1.5 py-1.5 text-left hover:bg-paper-2 max-sm:min-h-11',
                // Page numbers make a narrow column; a section's heading takes its own line.
                hit.pageStart ? 'items-baseline gap-3' : 'flex-col gap-0.5',
              )}
            >
              <span
                className={cn(
                  'font-serif text-sm text-ink oldstyle-nums',
                  hit.pageStart ? 'w-14 shrink-0' : 'min-w-0 truncate',
                )}
              >
                {placeLabel(hit)}
              </span>
              <span className="min-w-0 flex-1 text-xs text-ink-2">
                <Highlight text={snippetAround(hit.content, query, 120)} query={query} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A book page or a site's section listed once, at its best-scoring passage. */
function onePerPlace(hits: SearchHit[]) {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = hit.pageStart
      ? `p${hit.pageStart}`
      : `${hit.documentPath}#${hit.headingPath.at(-1) ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function placeLabel(hit: SearchHit) {
  if (hit.pageStart) return `p. ${hit.pageStart}`;
  return hit.headingPath.at(-1) ?? hit.documentPath;
}
