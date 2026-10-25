import { lazy, Suspense, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { graphPathQueryOptions } from '@/api/queries';
import { isApiError } from '@/api/client';
import { useBreakpoint } from '@/lib/breakpoints';
import { Spinner } from '@/ui';
import { graphRoute } from './search';
import { useGraphNavigation, useSymbolById } from './hooks';
import { layoutPath } from './layout';
import { SymbolCombobox } from './SymbolCombobox';
import { SymbolLine } from './SymbolLine';
import { graphStrings as t } from './strings';

const GraphCanvas = lazy(() => import('./GraphCanvas'));

/** "Trace from … to …": the shortest chain of calls between two symbols. */
export function TraceView({ repo }: { repo: string }) {
  const bp = useBreakpoint();
  const search = graphRoute.useSearch();
  const navigate = graphRoute.useNavigate();
  const { openInViewer, focus } = useGraphNavigation(repo);
  const from = useSymbolById(repo, search.from);
  const to = useSymbolById(repo, search.to);
  const path = useQuery({
    ...graphPathQueryOptions(repo, search.from ?? '', search.to ?? ''),
    enabled: Boolean(search.from && search.to),
  });

  const chain = path.data?.path;
  const layout = useMemo(() => (chain ? layoutPath(chain) : undefined), [chain]);
  const highlight = useMemo(() => new Set(layout?.nodes.map((n) => n.id)), [layout]);

  const label = (s: typeof from.data) => (s ? `${s.name}  ${s.filePath}` : undefined);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid max-w-[880px] gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink">{t.traceFrom}</span>
          <SymbolCombobox
            repo={repo}
            label={t.traceFrom}
            selectedName={label(from.data)}
            onPick={(s) => navigate({ search: (prev) => ({ ...prev, from: s.id }) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink">{t.traceTo}</span>
          <SymbolCombobox
            repo={repo}
            label={t.traceTo}
            selectedName={label(to.data)}
            onPick={(s) => navigate({ search: (prev) => ({ ...prev, to: s.id }) })}
          />
        </div>
      </div>

      {!search.from || !search.to ? (
        <p className="max-w-[560px] text-sm text-ink-2">{t.traceHint}</p>
      ) : path.isPending ? (
        <Spinner className="size-4" label={t.loading} />
      ) : path.error ? (
        <p className="text-sm text-error">{isApiError(path.error, 404) ? t.notFound : t.error}</p>
      ) : !chain ? (
        <p className="text-sm text-ink-2">
          {t.noPath} {path.data.truncated && t.pathTruncated}
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-3">{t.steps(chain.length - 1)}</p>
          {bp !== 'phone' && layout && (
            <div className="h-48 overflow-hidden rounded-md border border-rule">
              <Suspense fallback={null}>
                <GraphCanvas
                  layout={layout}
                  highlight={highlight}
                  showMinimap={false}
                  onOpen={openInViewer}
                  onFocus={(s) => focus(s.id)}
                  label={`${t.traceFrom} ${chain[0]!.name} ${t.traceTo.toLowerCase()} ${chain.at(-1)!.name}`}
                />
              </Suspense>
            </div>
          )}
          <ol className="max-w-[720px]">
            {chain.map((s, i) => (
              <li key={`${s.id}-${i}`} className="flex gap-3">
                <span className="flex w-6 shrink-0 flex-col items-center">
                  <span className="pt-3 font-mono text-xs text-ink-3">{i + 1}</span>
                  {i < chain.length - 1 && (
                    <span aria-hidden className="mt-1 w-px flex-1 bg-rule-2" />
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => openInViewer(s)}
                  className="flex min-h-11 min-w-0 flex-1 items-center border-b border-rule text-left hover:bg-paper-2"
                >
                  <SymbolLine symbol={s} />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
