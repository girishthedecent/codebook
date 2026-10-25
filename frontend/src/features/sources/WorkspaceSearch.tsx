import { useId, useState, type FormEvent } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { useSearch } from '@/api/queries/sources';
import type { SearchHit } from '@/api/types';
import { cn } from '@/lib/cn';
import type { ViewerTarget } from '@/lib/viewerParams';
import { Button, Input, Spinner } from '@/ui';
import { typeMark } from './sourceMeta';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';

const d = strings.detail;

/**
 * Debug retrieval for owners: runs the same search the agent does and shows the scores, so
 * it's visible why an answer cited what it cited. Collapsed by default; searches on submit.
 */
export function WorkspaceSearch({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const panelId = useId();
  const search = useSearch(workspaceId, { query, topK: 8, expandParents: false });
  const openInViewer = useOpenInViewer();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };

  return (
    <section className="mt-8 border-t border-rule">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="flex min-h-10 w-full items-center gap-2 text-left text-sm font-medium text-ink"
      >
        <CaretRight
          size={12}
          className={cn('text-ink-3 transition-transform duration-150', open && 'rotate-90')}
        />
        {d.search}
      </button>
      {open && (
        <div id={panelId} className="pb-4">
          <p className="text-xs text-ink-3">{d.searchHint}</p>
          <form onSubmit={submit} className="mt-3 flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={d.searchPlaceholder}
              aria-label={d.searchPlaceholder}
              className="flex-1"
            />
            <Button type="submit" variant="secondary" disabled={!draft.trim()}>
              Search
            </Button>
          </form>

          {search.isFetching && (
            <div className="mt-4 flex items-center gap-2 text-sm text-ink-3">
              <Spinner className="size-3.5" /> Searching
            </div>
          )}
          {search.isError && <p className="mt-4 text-sm text-error">{search.error.message}</p>}
          {search.data && !search.isFetching && (
            <ol className="mt-3">
              {search.data.results.length === 0 && (
                <li className="py-3 text-sm text-ink-3">{d.noHits}</li>
              )}
              {search.data.results.map((hit, i) => (
                <Hit key={hit.chunkId} hit={hit} rank={i + 1} onOpen={openInViewer} />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function Hit({
  hit,
  rank,
  onOpen,
}: {
  hit: SearchHit;
  rank: number;
  onOpen: (target: ViewerTarget) => void;
}) {
  const target = hitTarget(hit);
  const where = hit.pageStart
    ? `p. ${hit.pageStart}`
    : hit.lineStart
      ? `${hit.documentPath}:${hit.lineStart}${hit.lineEnd && hit.lineEnd !== hit.lineStart ? `–${hit.lineEnd}` : ''}`
      : (hit.headingPath.at(-1) ?? hit.documentPath);
  const scores = Object.entries(hit.scores)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k} ${(v as number).toFixed(3)}`)
    .join('  ');

  return (
    <li className="border-b border-rule">
      <button
        type="button"
        onClick={() => onOpen(target)}
        className="block w-full py-3 text-left hover:bg-paper-2/60"
      >
        <div className="flex items-baseline gap-2 font-mono text-xs text-ink-3">
          <span className="w-5 shrink-0 text-right">{rank}</span>
          <span className="shrink-0">{typeMark[hit.sourceType]}</span>
          <span className="min-w-0 truncate text-ink-2">
            {hit.sourceTitle} · {where}
          </span>
        </div>
        <p className="mt-1 line-clamp-3 pl-7 font-serif text-sm text-ink">{hit.content}</p>
        {scores && <div className="mt-1 pl-7 font-mono text-[11px] text-ink-3">{scores}</div>}
      </button>
    </li>
  );
}

function hitTarget(hit: SearchHit): ViewerTarget {
  if (hit.pageStart) return { kind: 'page', sourceId: hit.sourceId, page: hit.pageStart };
  return {
    kind: 'file',
    sourceId: hit.sourceId,
    path: hit.documentPath,
    lineStart: hit.lineStart ?? undefined,
    lineEnd: hit.lineEnd ?? undefined,
    heading: hit.sourceType === 'WEBSITE' ? hit.headingPath.at(-1) : undefined,
  };
}
