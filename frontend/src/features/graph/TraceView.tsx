import { lazy, Suspense, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import { graphPathQueryOptions } from '@/api/queries';
import type { GraphSymbol } from '@/api/types';
import { useBreakpoint } from '@/lib/breakpoints';
import { Button, Callout, Skeleton, TextButton } from '@/ui';
import { graphRoute } from './search';
import { useGraphNavigation, useSymbolByRef } from './hooks';
import { layoutPath } from './layout';
import { ErrorNote } from './ErrorNote';
import { SymbolCombobox } from './SymbolCombobox';
import { graphStrings as t, kindLabel } from './strings';

const GraphCanvas = lazy(() => import('./GraphCanvas'));

const label = (s: GraphSymbol | undefined) => (s ? `${s.name}  ${s.filePath}` : undefined);

/** "Trace from A to B": the shortest chain of calls between two symbols, within 6 calls. */
export function TraceView({ repo }: { repo: string }) {
  const bp = useBreakpoint();
  const search = graphRoute.useSearch();
  const navigate = graphRoute.useNavigate();
  const { openInViewer, focus } = useGraphNavigation(repo);
  const { fromSym, toSym } = search;
  const from = useSymbolByRef(repo, fromSym);
  const to = useSymbolByRef(repo, toSym);
  const path = useQuery({
    ...graphPathQueryOptions(repo, fromSym ?? '', toSym ?? ''),
    enabled: Boolean(fromSym && toSym),
  });

  const chain = path.data?.path;
  const layout = useMemo(() => (chain ? layoutPath(chain) : undefined), [chain]);
  const highlight = useMemo(() => new Set(layout?.nodes.map((n) => n.id)), [layout]);

  const swap = () =>
    void navigate({ search: (prev) => ({ ...prev, fromSym: prev.toSym, toSym: prev.fromSym }) });

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose font-serif text-base text-pretty text-ink-2">
        {t.traceIntro(t.traceMaxCalls)}
      </p>

      <div className="grid max-w-4xl items-end gap-x-3 gap-y-2 sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink">{t.traceFrom}</span>
          <SymbolCombobox
            repo={repo}
            label={t.traceFrom}
            selectedName={label(from.data)}
            onPick={(s) =>
              void navigate({ search: (prev) => ({ ...prev, fromSym: s.qualifiedName }) })
            }
          />
        </div>
        <Button
          aria-label={t.swap}
          title={t.swap}
          disabled={!fromSym && !toSym}
          onClick={swap}
          className="size-9 px-0 max-sm:size-11 max-sm:justify-self-start"
        >
          <ArrowsLeftRight size={16} aria-hidden className="max-sm:rotate-90" />
        </Button>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink">{t.traceTo}</span>
          <SymbolCombobox
            repo={repo}
            label={t.traceTo}
            selectedName={label(to.data)}
            onPick={(s) =>
              void navigate({ search: (prev) => ({ ...prev, toSym: s.qualifiedName }) })
            }
          />
        </div>
      </div>

      {(from.error || to.error) && <ErrorNote error={(from.error ?? to.error)!} />}

      {!fromSym || !toSym ? null : path.isPending ? (
        <Skeleton className="h-24 w-full max-w-3xl" />
      ) : path.error ? (
        <ErrorNote error={path.error} onRetry={() => void path.refetch()} />
      ) : !chain ? (
        <Callout tone="info" className="max-w-3xl">
          <p className="text-ink">{t.noPath(t.traceMaxCalls)}</p>
          <p className="mt-1">
            {path.data.truncated ? t.pathTruncated : t.noPathSwap}{' '}
            <TextButton className="py-2" onClick={swap}>
              {t.swap}
            </TextButton>
          </p>
        </Callout>
      ) : (
        <>
          <p className="max-w-3xl font-serif text-base text-ink">
            <code className="font-mono text-[0.85em] font-medium">{chain[0]!.name}</code>{' '}
            {t.reaches}{' '}
            <code className="font-mono text-[0.85em] font-medium">{chain.at(-1)!.name}</code>{' '}
            {t.withinCalls(chain.length - 1)}.
          </p>
          {bp !== 'phone' && layout && (
            <Suspense fallback={<Skeleton className="h-48 w-full" />}>
              <GraphCanvas
                layout={layout}
                highlight={highlight}
                showMinimap={false}
                onOpen={openInViewer}
                onFocus={focus}
                label={`${t.traceFrom} ${chain[0]!.name} ${t.traceTo.toLowerCase()} ${chain.at(-1)!.name}`}
              />
            </Suspense>
          )}
          <ol className="max-w-3xl">
            {chain.map((s, i) => (
              <li key={`${s.id}-${i}`} className="flex gap-3">
                <span className="flex w-6 shrink-0 flex-col items-center">
                  <span className="pt-2 font-serif text-base text-ink-3 tabular-nums">{i + 1}</span>
                  {i < chain.length - 1 && (
                    <span aria-hidden className="mt-1 w-px flex-1 bg-edge" />
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => openInViewer(s)}
                  title={t.openInViewer}
                  className="mb-1 min-w-0 flex-1 rounded-sm px-2 py-2 text-left hover:bg-paper-2"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate font-mono text-sm text-ink">{s.name}</span>
                    <span className="shrink-0 text-xs text-ink-3">{kindLabel(s.kind)}</span>
                  </span>
                  <span className="block truncate font-mono text-xs text-ink-3">
                    {s.filePath}:{s.lineStart}
                  </span>
                  {s.signature && (
                    <span className="block truncate font-mono text-xs text-ink-2">
                      {s.signature}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
