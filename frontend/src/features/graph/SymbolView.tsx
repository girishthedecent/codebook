import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { askAbout } from '@/lib/askAbout';
import { useBreakpoint } from '@/lib/breakpoints';
import type { GraphSymbol } from '@/api/types';
import { Button, Skeleton, TabPanel, Tabs, TextButton } from '@/ui';
import { graphRoute, type Direction } from './search';
import { useGraphNavigation, useNeighborhood, useOverview, useSymbolByRef } from './hooks';
import { layoutNeighborhood } from './layout';
import { CompactMap } from './CompactMap';
import { Connections } from './GraphTree';
import { ErrorNote } from './ErrorNote';
import { Segmented } from './Segmented';
import { graphStrings as t, kindLabel, kindNoun } from './strings';

const GraphCanvas = lazy(() => import('./GraphCanvas'));

// At or below this many symbols a map is a handful of boxes; a list reads better.
const LIST_ALWAYS = 12;

/** One symbol: what it is, then who calls it and what it calls, with an optional map. */
export function SymbolView({ repo, symbolRef }: { repo: string; symbolRef: string }) {
  const bp = useBreakpoint();
  const search = graphRoute.useSearch();
  const navigate = graphRoute.useNavigate();
  const { workspaceId } = graphRoute.useParams();
  const toChat = useNavigate();
  const nav = useGraphNavigation(repo);
  const symbol = useSymbolByRef(repo, symbolRef);
  const overview = useOverview(repo);
  const packages = useMemo(
    () => (overview.data?.packages ?? []).map((p) => p.name.replace(/^node:/, '')),
    [overview.data],
  );
  const view = bp === 'phone' ? 'list' : (search.view ?? 'list');

  if (symbol.error) {
    return (
      <div className="flex max-w-prose flex-col items-start gap-3">
        <ErrorNote error={symbol.error} onRetry={() => void symbol.refetch()} />
        <TextButton
          className="inline-flex min-h-10 items-center"
          onClick={() => void navigate({ search: (prev) => ({ ...prev, symbol: undefined }) })}
        >
          {t.startTitle}
        </TextButton>
      </div>
    );
  }
  if (!symbol.data) return <SymbolLoading />;
  const center = symbol.data;

  const connections = (
    <Connections
      repo={repo}
      center={center}
      packages={packages}
      onOpen={nav.openInViewer}
      onFocus={nav.focus}
    />
  );

  return (
    <div>
      <SymbolHeader
        symbol={center}
        onOpen={() => nav.openInViewer(center)}
        onTraceFrom={() => nav.traceFrom(center)}
        onTraceTo={() => nav.traceTo(center)}
        onAsk={() => {
          askAbout({
            quote: center.signature ?? `${kindLabel(center.kind)} ${center.name}`,
            label: symbolCaption(center),
            target: {
              kind: 'file',
              sourceId: repo,
              path: center.filePath,
              lineStart: center.lineStart,
              lineEnd: center.lineEnd,
            },
          });
          void toChat({ to: '/w/$workspaceId', params: { workspaceId } });
        }}
      />
      {bp === 'phone' ? (
        connections
      ) : (
        <Tabs
          label={t.mapLabel}
          value={view}
          onValueChange={(v) =>
            void navigate({ search: (prev) => ({ ...prev, view: v as 'list' | 'map' }) })
          }
          items={[
            { value: 'list', label: t.connections },
            { value: 'map', label: t.map },
          ]}
        >
          <TabPanel value="list" className="pt-6">
            {connections}
          </TabPanel>
          <TabPanel value="map" className="pt-5">
            <MapPanel repo={repo} center={center} />
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}

function SymbolLoading() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">{t.loading}</span>
      <Skeleton className="h-8 w-3/5" />
      <Skeleton className="h-12 w-2/5" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="font-mono text-[0.82em] font-medium">{children}</code>
);

/** "GPT, a class in model.py"; a method names its class, a file is just itself. */
function SymbolHeader({
  symbol,
  onOpen,
  onTraceFrom,
  onTraceTo,
  onAsk,
}: {
  symbol: GraphSymbol;
  onOpen: () => void;
  onTraceFrom: () => void;
  onTraceTo: () => void;
  onAsk: () => void;
}) {
  const file = symbol.kind === 'FILE';
  const owner = symbol.kind === 'METHOD' ? ownerOf(symbol) : undefined;

  return (
    <header className="mb-8 max-w-3xl">
      <h2 className="heading-page [overflow-wrap:anywhere]">
        <Code>{file ? symbol.filePath : symbol.name}</Code>, {kindNoun(symbol.kind)}
        {owner && (
          <>
            {' '}
            {t.methodOf} <Code>{owner}</Code>
          </>
        )}
        {!file && (
          <>
            {' '}
            {t.inFile} <Code>{symbol.filePath}</Code>
          </>
        )}
      </h2>
      {symbol.signature && (
        <blockquote className="mt-4 border-l-2 border-accent pl-4">
          <code className="block font-mono text-sm break-words whitespace-pre-wrap text-ink-2">
            {symbol.signature}
          </code>
        </blockquote>
      )}
      <p className="mt-3 text-xs text-ink-3">
        <TextButton onClick={onOpen} title={t.openInViewer}>
          {symbol.filePath}
        </TextButton>
        {file ? '' : `, ${t.lines(symbol.lineStart, symbol.lineEnd)}`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onTraceFrom}>
          {t.traceFromHere}
        </Button>
        <Button size="sm" onClick={onTraceTo}>
          {t.traceToHere}
        </Button>
        <Button size="sm" onClick={onAsk}>
          {t.askAbout}
        </Button>
      </div>
    </header>
  );
}

/** "model.py, lines 42–61", the way a citation names a listing; a file is just its path. */
function symbolCaption(symbol: GraphSymbol) {
  if (symbol.kind === 'FILE') return symbol.filePath;
  return `${symbol.filePath}, ${t.lines(symbol.lineStart, symbol.lineEnd)}`;
}

/** The class a method belongs to, from its qualified name (`model.py#GPT.forward`). */
function ownerOf(symbol: GraphSymbol) {
  const path = symbol.qualifiedName.split('#')[1]?.split('.');
  return path && path.length > 1 ? path.slice(0, -1).join('.') : undefined;
}

function MapPanel({ repo, center }: { repo: string; center: GraphSymbol }) {
  const bp = useBreakpoint();
  const search = graphRoute.useSearch();
  const navigate = graphRoute.useNavigate();
  const { openInViewer, focus } = useGraphNavigation(repo);
  const dir: Direction = search.dir ?? 'both';
  const depth = search.depth ?? 2;
  const n = useNeighborhood(repo, center.qualifiedName, dir, depth);
  const layout = useMemo(
    () => (n.center ? layoutNeighborhood(n.center, n.callers, n.dependencies) : undefined),
    [n.center, n.callers, n.dependencies],
  );

  const set = (patch: Partial<{ dir: Direction; depth: number; view: 'list' | 'map' }>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const truncated = n.callers?.truncated || n.dependencies?.truncated;
  const hidden = layout?.hidden ?? 0;
  const shown = layout ? layout.nodes.length - 1 : 0;
  const small = layout !== undefined && layout.nodes.length <= LIST_ALWAYS;

  return (
    <div className="flex flex-col gap-4">
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
      </div>

      {n.error ? (
        <ErrorNote error={n.error} onRetry={n.refetch} />
      ) : !layout ? (
        <Skeleton className="h-60 w-full" />
      ) : small ? (
        <>
          <p className="text-xs text-ink-3">{t.mapSmall}</p>
          <CompactMap layout={layout} onOpen={openInViewer} onFocus={focus} />
        </>
      ) : (
        <>
          <p className="text-xs text-ink-3">{t.mapLegend}</p>
          <Suspense fallback={<Skeleton className="h-60 w-full" />}>
            <GraphCanvas
              layout={layout}
              showMinimap={bp === 'desktop' && layout.nodes.length > LIST_ALWAYS}
              onOpen={openInViewer}
              onFocus={focus}
              onMore={() => set({ view: 'list' })}
              label={`${t.title}: ${center.name}`}
            />
          </Suspense>
        </>
      )}

      {(truncated || hidden > 0) && (
        <p className="text-xs text-ink-3">
          {hidden > 0 && `${t.capped(shown, shown + hidden)} `}
          {truncated && t.truncated}
        </p>
      )}
    </div>
  );
}
