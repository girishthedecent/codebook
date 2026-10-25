import { lazy, Suspense, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useSources } from '@/api/queries';
import { flatItems } from '@/api/queries/keys';
import { isApiError } from '@/api/client';
import type { GraphSymbol, Source } from '@/api/types';
import { useBreakpoint } from '@/lib/breakpoints';
import { controlClass, Spinner, Tabs, TabPanel } from '@/ui';
import { cn } from '@/lib/cn';
import { graphRoute, type Direction } from './search';
import { useGraphNavigation, useNeighborhood, useSymbolById, useSymbolMatches } from './hooks';
import { layoutNeighborhood } from './layout';
import { GraphTree } from './GraphTree';
import { Segmented } from './Segmented';
import { SymbolCombobox } from './SymbolCombobox';
import { SymbolLine } from './SymbolLine';
import { TraceView } from './TraceView';
import { graphStrings as t, kindLabel } from './strings';

const GraphCanvas = lazy(() => import('./GraphCanvas'));

type GraphStats = { calls?: number; callsResolved?: number };

/** The code graph page: pick a repository and a symbol, see who calls it and what it calls. */
export function GraphPage() {
  const { workspaceId } = graphRoute.useParams();
  const search = graphRoute.useSearch();
  const navigate = graphRoute.useNavigate();
  const sources = useSources(workspaceId);
  const repos = flatItems(sources.data).filter((s) => s.type === 'GITHUB_REPO');

  if (sources.isPending) {
    return (
      <Frame>
        <Spinner className="size-4" label={t.loading} />
      </Frame>
    );
  }

  const repo =
    repos.find((r) => r.id === search.repo) ??
    repos.find((r) => r.id === search.src) ??
    repos.find((r) => r.status === 'READY') ??
    repos[0];

  if (!repo) {
    return (
      <Frame>
        <p className="text-sm text-ink-2">
          {t.noRepo}{' '}
          <Link
            to="/w/$workspaceId/sources"
            params={{ workspaceId }}
            className="text-accent underline underline-offset-2"
          >
            {t.addRepo}
          </Link>
          .
        </p>
      </Frame>
    );
  }

  const pickRepo = (id: string) =>
    navigate({
      search: (prev) => ({ ...prev, repo: id, symbol: undefined, from: undefined, to: undefined }),
    });

  return (
    <Frame>
      <div className="flex flex-wrap items-end gap-3">
        {repos.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="graph-repo" className="text-xs font-medium text-ink">
              {t.repo}
            </label>
            <select
              id="graph-repo"
              value={repo.id}
              onChange={(e) => pickRepo(e.target.value)}
              className={cn(controlClass, 'h-9 w-auto max-w-64 pr-8')}
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <RepoBody repo={repo} />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-5 md:px-6">
      <h1 className="text-lg font-semibold">{t.title}</h1>
      {children}
    </div>
  );
}

function RepoBody({ repo }: { repo: Source }) {
  const search = graphRoute.useSearch();
  const navigate = graphRoute.useNavigate();
  const mode = search.mode ?? 'explore';

  if (repo.status !== 'READY') {
    return (
      <p className="text-sm text-ink-2">{repo.status === 'FAILED' ? t.noGraph : t.indexing}</p>
    );
  }
  const stats = (repo.stats as { graph?: GraphStats }).graph;
  if (!stats) return <p className="text-sm text-ink-2">{t.noGraph}</p>;
  const resolved =
    stats.calls && stats.callsResolved !== undefined
      ? Math.round((stats.callsResolved / stats.calls) * 100)
      : undefined;

  return (
    <>
      {resolved !== undefined && resolved < 90 && (
        <p className="-mt-2 max-w-[720px] text-xs text-ink-3">{t.resolution(resolved)}</p>
      )}
      <Tabs
        label={t.title}
        value={mode}
        onValueChange={(v) =>
          navigate({ search: (prev) => ({ ...prev, mode: v as 'explore' | 'trace' }) })
        }
        items={[
          { value: 'explore', label: t.explore },
          { value: 'trace', label: t.trace },
        ]}
      >
        <TabPanel value="explore">
          <Explore repo={repo.id} />
        </TabPanel>
        <TabPanel value="trace">
          <TraceView repo={repo.id} />
        </TabPanel>
      </Tabs>
    </>
  );
}

function Explore({ repo }: { repo: string }) {
  const search = graphRoute.useSearch();
  const { focus } = useGraphNavigation(repo);
  const picked = useSymbolById(repo, search.symbol);
  const fromViewer = !search.symbol && search.src === repo && search.path ? search.path : undefined;

  return (
    <div className="flex flex-col gap-4">
      <SymbolCombobox
        repo={repo}
        label={t.search}
        selectedName={picked.data ? `${picked.data.name}  ${picked.data.filePath}` : undefined}
        onPick={(s) => focus(s.id)}
        className="max-w-[560px]"
      />
      {search.symbol ? (
        picked.error && isApiError(picked.error, 404) ? (
          <p className="text-sm text-ink-2">{t.notFound}</p>
        ) : (
          <Neighborhood repo={repo} symbolId={search.symbol} />
        )
      ) : fromViewer ? (
        <FileSymbols repo={repo} path={fromViewer} onPick={(s) => focus(s.id)} />
      ) : (
        <p className="max-w-[560px] text-sm text-ink-2">{t.pickHint}</p>
      )}
    </div>
  );
}

function Neighborhood({ repo, symbolId }: { repo: string; symbolId: string }) {
  const bp = useBreakpoint();
  const search = graphRoute.useSearch();
  const navigate = graphRoute.useNavigate();
  const { openInViewer, focus } = useGraphNavigation(repo);
  const dir: Direction = search.dir ?? 'both';
  const depth = search.depth ?? 2;
  const view = bp === 'phone' ? 'list' : (search.view ?? 'canvas');
  const n = useNeighborhood(repo, symbolId, dir, depth);

  const layout = useMemo(
    () => (n.center ? layoutNeighborhood(n.center, n.callers, n.dependencies) : undefined),
    [n.center, n.callers, n.dependencies],
  );

  const set = (patch: Partial<{ dir: Direction; depth: number; view: 'canvas' | 'list' }>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }) });

  if (n.error) {
    return <p className="text-sm text-error">{isApiError(n.error, 404) ? t.notFound : t.error}</p>;
  }
  if (!n.center) {
    return (
      <div className="flex h-40 items-center">
        <Spinner className="size-4" label={t.loading} />
      </div>
    );
  }

  const truncated = n.callers?.truncated || n.dependencies?.truncated;
  const outside = n.dependencies?.external.length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <CenterHeader symbol={n.center} onOpen={() => openInViewer(n.center!)} />

      {view === 'canvas' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label={t.direction}
            value={dir}
            onChange={(v) => set({ dir: v })}
            options={[
              { value: 'callers', label: t.callers },
              { value: 'both', label: t.both },
              { value: 'dependencies', label: t.dependencies },
            ]}
          />
          <Segmented
            label={t.depth}
            value={depth}
            onChange={(v) => set({ depth: v })}
            options={[1, 2, 3].map((d) => ({ value: d, label: `${t.depth} ${d}` }))}
          />
          <span className="text-xs text-ink-3">{t.legend}</span>
          <span className="ml-auto" />
          <Segmented
            label="View"
            value={view}
            onChange={(v) => set({ view: v })}
            options={[
              { value: 'canvas', label: t.canvas },
              { value: 'list', label: t.list },
            ]}
          />
        </div>
      )}
      {view === 'list' && bp !== 'phone' && (
        <div>
          <Segmented
            label="View"
            value={view}
            onChange={(v) => set({ view: v })}
            options={[
              { value: 'canvas', label: t.canvas },
              { value: 'list', label: t.list },
            ]}
          />
        </div>
      )}

      {view === 'canvas' && layout ? (
        <div className="relative h-[calc(100dvh-19rem)] min-h-[420px] overflow-hidden rounded-md border border-rule">
          {n.isPending && (
            <div className="absolute inset-x-0 top-0 z-10 h-px bg-accent/50" aria-hidden />
          )}
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner className="size-4" label={t.loading} />
              </div>
            }
          >
            <GraphCanvas
              layout={layout}
              showMinimap={bp === 'desktop' && layout.nodes.length > 12}
              onOpen={openInViewer}
              onFocus={(s) => focus(s.id)}
              label={`${t.title}: ${n.center.name}`}
            />
          </Suspense>
        </div>
      ) : (
        <GraphTree repo={repo} center={n.center} onOpen={openInViewer} onFocus={focus} />
      )}

      {(truncated || outside > 0) && (
        <p className="text-xs text-ink-3">
          {truncated && t.truncated} {outside > 0 && t.outside(outside)}
        </p>
      )}
    </div>
  );
}

function CenterHeader({ symbol, onOpen }: { symbol: GraphSymbol; onOpen: () => void }) {
  return (
    <div className="flex flex-col gap-1 border-b border-rule pb-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-ink-3">
          {kindLabel[symbol.kind] ?? symbol.kind}
        </span>
        <span className="font-mono text-base font-medium text-ink">{symbol.name}</span>
        <button
          type="button"
          onClick={onOpen}
          className="font-mono text-xs text-accent underline-offset-2 hover:underline"
          title={t.openInViewer}
        >
          {symbol.filePath}:{symbol.lineStart}
          {symbol.lineEnd !== symbol.lineStart && `–${symbol.lineEnd}`}
        </button>
      </div>
      {symbol.signature && (
        <code className="block truncate font-mono text-xs text-ink-2">{symbol.signature}</code>
      )}
    </div>
  );
}

/** Arrived from the code viewer: the symbols defined in that file. */
function FileSymbols({
  repo,
  path,
  onPick,
}: {
  repo: string;
  path: string;
  onPick: (s: GraphSymbol) => void;
}) {
  const matches = useSymbolMatches(repo, path);
  // The search matches fragments anywhere in the name or qualified name; keep this file only.
  const items = (matches.data ?? [])
    .filter((s) => s.filePath === path)
    .sort((a, b) => (a.kind === 'FILE' ? -1 : b.kind === 'FILE' ? 1 : a.lineStart - b.lineStart));

  return (
    <section aria-labelledby="file-symbols" className="max-w-[720px]">
      <h2 id="file-symbols" className="mb-1 text-xs font-medium text-ink-2">
        {t.fileSymbols(path)}
      </h2>
      {matches.isPending ? (
        <Spinner className="size-4" label={t.loading} />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-3">{t.noFileSymbols}</p>
      ) : (
        <ul className="border-t border-rule">
          {items.map((s) => (
            <li key={s.id} className="border-b border-rule">
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex min-h-11 w-full items-center px-1 text-left hover:bg-paper-2"
              >
                <SymbolLine symbol={s} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
