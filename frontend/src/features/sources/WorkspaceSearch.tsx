import { useId, useState, type FormEvent } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { useIsDemoWorkspace } from '@/api/queries/demo';
import { useSearch } from '@/api/queries/sources';
import type { SearchBody, SearchHit } from '@/api/types';
import { useMe } from '@/auth/useMe';
import { Highlight, hitTarget, hitWhere, snippetAround } from '@/features/command/passages';
import { cn } from '@/lib/cn';
import { displayTitle } from '@/lib/displayTitle';
import type { ViewerTarget } from '@/lib/viewerParams';
import { Button, Callout, Checkbox, Field, Input, Select, Skeleton, SourceBadge } from '@/ui';
import { searchStrings as t } from './WorkspaceSearch.strings';
import { useOpenInViewer } from './useOpenInViewer';

type Mode = NonNullable<SearchBody['mode']>;
const modes: Mode[] = ['hybrid', 'keyword', 'vector'];

/**
 * Search over the workspace's sources: the same search the agent runs. Anyone may use it in
 * the demo, where hits are short snippets; the workspace's owner also picks the search mode
 * and reranking and sees how each hit scored. Collapsed by default; searches on submit.
 */
export function WorkspaceSearch({ workspaceId }: { workspaceId: string }) {
  const { isGuest } = useMe();
  const isDemo = useIsDemoWorkspace(workspaceId);
  const owner = !isGuest && !isDemo;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('hybrid');
  const [rerank, setRerank] = useState(false);
  const panelId = useId();
  // Visitors send only the words: the server refuses a mode or reranking they can't use.
  const body: SearchBody = owner
    ? { query, topK: 8, expandParents: false, mode, rerank }
    : { query, topK: 8, expandParents: false };
  const search = useSearch(workspaceId, body);
  const openInViewer = useOpenInViewer();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    // Same words again: the state doesn't change, so ask again directly (after an error, say).
    if (next === query) void search.refetch();
    else setQuery(next);
  };

  return (
    <section className="mt-10 border-t border-rule pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="heading-minor flex min-h-11 w-full items-center gap-2 text-left"
      >
        <CaretRight
          size={12}
          aria-hidden
          className={cn('text-ink-3 transition-transform duration-150', open && 'rotate-90')}
        />
        {t.title}
      </button>
      {open && (
        <div id={panelId} className="pb-4">
          <p className="text-xs text-ink-3">{owner ? t.ownerHint : t.hint}</p>
          <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t.placeholder}
                aria-label={t.placeholder}
                className="flex-1"
              />
              <Button
                type="submit"
                variant="secondary"
                loading={search.isFetching}
                disabled={!draft.trim()}
              >
                {t.search}
              </Button>
            </div>
            {owner && (
              <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
                <Field label={t.mode} className="w-44">
                  <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                    {modes.map((m) => (
                      <option key={m} value={m}>
                        {t.modes[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Checkbox
                  checked={rerank}
                  onCheckedChange={setRerank}
                  label={t.rerank}
                  description={t.rerankHint}
                />
              </div>
            )}
          </form>

          {search.isFetching && (
            <div role="status" className="mt-4 flex flex-col gap-3">
              <span className="sr-only">{t.searching}</span>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}
          {search.isError && !search.isFetching && (
            <Callout error={search.error} onRetry={() => void search.refetch()} className="mt-4" />
          )}
          {search.data && !search.isFetching && (
            <>
              {owner && <Debug debug={search.data.debug} />}
              <ol className="mt-3 flex flex-col">
                {search.data.results.length === 0 && (
                  <li className="py-3 font-serif text-base text-ink-3">{t.noHits}</li>
                )}
                {search.data.results.map((hit, i) => (
                  <Hit
                    key={hit.chunkId}
                    hit={hit}
                    rank={i + 1}
                    query={query}
                    showScores={owner}
                    onOpen={openInViewer}
                  />
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** One line on how the search ran: whether it found much, whether it reranked, how long. */
function Debug({ debug }: { debug: Record<string, unknown> }) {
  const parts: string[] = [];
  if (debug.weak === true) parts.push(t.weak);
  if (debug.rerank === 'used') parts.push(t.reranked);
  else if (debug.rerank === 'unavailable') parts.push(t.rerankUnavailable);
  const total = (debug.timings as { total?: number } | undefined)?.total;
  if (typeof total === 'number') parts.push(`${total} ms`);
  if (parts.length === 0) return null;
  return <p className="mt-3 text-xs text-ink-3">{parts.join(' · ')}</p>;
}

function Hit({
  hit,
  rank,
  query,
  showScores,
  onOpen,
}: {
  hit: SearchHit;
  rank: number;
  query: string;
  showScores: boolean;
  onOpen: (target: ViewerTarget) => void;
}) {
  const scores = Object.entries(hit.scores)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k} ${(v as number).toFixed(3)}`)
    .join('  ');

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(hitTarget(hit))}
        className="flex w-full gap-3 rounded-sm px-2 py-3 text-left hover:bg-paper-2"
      >
        <span className="w-5 shrink-0 pt-0.5 text-right font-serif text-base text-ink-3 tabular-nums">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs text-ink-3">
            <SourceBadge type={hit.sourceType} />
            <span className="min-w-0 truncate">
              {displayTitle({ title: hit.sourceTitle, type: hit.sourceType }).name} ·{' '}
              {hitWhere(hit)}
            </span>
          </span>
          <span className="mt-1 line-clamp-3 block font-serif text-base text-ink">
            <Highlight text={snippetAround(hit.content, query, 320)} query={query} />
          </span>
          {showScores && scores && (
            <span className="mt-1 block font-mono text-xs text-ink-3">{scores}</span>
          )}
        </span>
      </button>
    </li>
  );
}
