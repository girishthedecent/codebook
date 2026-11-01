import type { ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { sourcesQueryOptions } from '@/api/queries';
import { useIsDemoWorkspace } from '@/api/queries/demo';
import { flatItems } from '@/api/queries/keys';
import { useMe } from '@/auth/useMe';
import type { Source } from '@/api/types';
import { useBreakpoint } from '@/lib/breakpoints';
import { displayTitle } from '@/lib/displayTitle';
import {
  BackLink,
  Callout,
  EmptyState,
  PageHeader,
  PageLoading,
  ProgressRule,
  SectionHeading,
  Select,
  TabPanel,
  Tabs,
  TextLink,
} from '@/ui';
import { graphRoute } from './search';
import { useGraphNavigation, useSymbolByRef } from './hooks';
import { ErrorNote } from './ErrorNote';
import { FileSymbols } from './FileSymbols';
import { Overview } from './Overview';
import { SymbolCombobox } from './SymbolCombobox';
import { SymbolView } from './SymbolView';
import { TraceView } from './TraceView';
import { graphStrings as t, stageWords } from './strings';

type GraphStats = { symbols?: number; calls?: number; callsResolved?: number };

// What the graph is built for; anything else is indexed for search and chat only.
const GRAPH_LANGUAGES = ['javascript', 'typescript', 'tsx', 'python'];
const NOT_CODE = ['text', 'markdown', 'json', 'yaml', 'toml'];

/** The code graph page: pick a repository, start from its busiest symbols or search for one. */
export function GraphPage() {
  const { workspaceId } = graphRoute.useParams();
  const search = graphRoute.useSearch();
  const { isGuest } = useMe();
  const isDemo = useIsDemoWorkspace(workspaceId);
  const navigate = graphRoute.useNavigate();
  const sources = useInfiniteQuery({
    ...sourcesQueryOptions(workspaceId),
    // A repository that is still indexing turns ready on its own; check back until it does.
    refetchInterval: (q) =>
      q.state.data?.pages.some((p) =>
        p.items.some(
          (s) => s.type === 'GITHUB_REPO' && (s.status === 'PENDING' || s.status === 'PROCESSING'),
        ),
      )
        ? 4000
        : false,
  });
  const repos = flatItems(sources.data).filter((s) => s.type === 'GITHUB_REPO');

  if (sources.isError && !sources.data) {
    return (
      <Frame>
        <ErrorNote
          error={sources.error}
          title={t.sourcesError}
          onRetry={() => void sources.refetch()}
        />
      </Frame>
    );
  }
  if (sources.isPending) {
    return (
      <Frame>
        <PageLoading label={t.loading} rows={2} />
      </Frame>
    );
  }

  const repo =
    repos.find((r) => r.id === search.repo) ??
    repos.find((r) => r.id === search.src) ??
    repos.find((r) => r.status === 'READY') ??
    repos[0];

  if (!repo) {
    const canAdd = !isGuest && !isDemo;
    return (
      <Frame>
        <EmptyState
          action={
            canAdd && (
              <TextLink to="/w/$workspaceId/sources" params={{ workspaceId }}>
                {t.addRepo}
              </TextLink>
            )
          }
        >
          {canAdd ? t.noRepo : t.noRepoGuest}
        </EmptyState>
      </Frame>
    );
  }

  const pickRepo = (id: string) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        repo: id,
        symbol: undefined,
        fromSym: undefined,
        toSym: undefined,
      }),
    });

  const { name, ref } = displayTitle(repo);
  const stats = repo.status === 'READY' ? graphStats(repo) : undefined;

  return (
    <Frame
      kicker={t.title}
      title={
        <>
          {name}
          {ref && <span className="ml-2 font-mono text-sm font-normal text-ink-3">@{ref}</span>}
        </>
      }
      intro={stats?.symbols ? statsLine(stats) : undefined}
      actions={
        repos.length > 1 && (
          <Select
            aria-label={t.repo}
            value={repo.id}
            onChange={(e) => pickRepo(e.target.value)}
            className="w-64 max-w-full"
          >
            {repos.map((r) => {
              const d = displayTitle(r);
              return (
                <option key={r.id} value={r.id}>
                  {d.ref ? `${d.name} @${d.ref}` : d.name}
                </option>
              );
            })}
          </Select>
        )
      }
    >
      <RepoBody repo={repo} workspaceId={workspaceId} canResync={!isGuest && !isDemo} />
    </Frame>
  );
}

function Frame({
  children,
  kicker,
  title = t.title,
  intro,
  actions,
}: {
  children: ReactNode;
  kicker?: string;
  title?: ReactNode;
  intro?: ReactNode;
  actions?: ReactNode;
}) {
  const phone = useBreakpoint() === 'phone';
  const { workspaceId } = useParams({ strict: false }) as { workspaceId: string };
  return (
    <div className="mx-auto w-full max-w-wide px-4 py-6 sm:px-6 sm:py-8">
      {/* On phones the graph lives under More, so that is the way up. */}
      {phone && (
        <BackLink to="/w/$workspaceId/more" params={{ workspaceId }} className="mb-3">
          {t.back}
        </BackLink>
      )}
      <PageHeader kicker={kicker} title={title} intro={intro} actions={actions} />
      {children}
    </div>
  );
}

function graphStats(repo: Source): GraphStats | undefined {
  return (repo.stats as { graph?: GraphStats }).graph;
}

function statsLine({ symbols = 0, calls = 0, callsResolved = 0 }: GraphStats) {
  return (
    <span className="text-sm font-sans text-ink-3">
      {t.statsLine({ symbols, inside: callsResolved, outside: Math.max(0, calls - callsResolved) })}
    </span>
  );
}

/** The languages a repository is written in, most files first, without prose and data files. */
function mainLanguages(repo: Source) {
  const counts = (repo.stats as { languages?: Record<string, number> }).languages ?? {};
  return Object.entries(counts)
    .filter(([name]) => !NOT_CODE.includes(name))
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

const label = (language: string) => language[0]!.toUpperCase() + language.slice(1);

function RepoBody({
  repo,
  workspaceId,
  canResync,
}: {
  repo: Source;
  workspaceId: string;
  canResync: boolean;
}) {
  const search = graphRoute.useSearch();
  const navigate = graphRoute.useNavigate();
  const mode = search.mode ?? 'explore';
  const { name } = displayTitle(repo);

  const toSource = (
    <TextLink
      to="/w/$workspaceId/sources/$sourceId"
      params={{ workspaceId, sourceId: repo.id }}
      className="inline-flex min-h-11 items-center"
    >
      {t.openSource}
    </TextLink>
  );

  if (repo.status === 'PENDING' || repo.status === 'PROCESSING') {
    return (
      <Callout tone="info" title={t.stateIndexing(name)} className="max-w-xl" action={toSource}>
        <p>{stageWords[repo.stage]}</p>
        <ProgressRule
          className="my-3"
          value={repo.progress / 100}
          label={`${t.stateIndexing(name)}: ${stageWords[repo.stage]}`}
        />
        <p className="text-xs text-ink-3">{t.stateIndexingHint}</p>
      </Callout>
    );
  }
  if (repo.status === 'FAILED') {
    return (
      <Callout tone="error" title={t.stateFailed} className="max-w-xl" action={toSource}>
        <p className="break-words">{repo.error ?? t.stateFailedNoReason}</p>
      </Callout>
    );
  }

  if (!graphStats(repo)) {
    const code = mainLanguages(repo);
    if (code.length > 0 && !code.some((l) => GRAPH_LANGUAGES.includes(l))) {
      return (
        <Callout tone="info" title={t.unsupportedTitle} className="max-w-xl">
          {t.unsupported(code.slice(0, 2).map(label).join(' and '))}
        </Callout>
      );
    }
    return (
      <Callout
        tone="info"
        title={t.noGraphTitle}
        className="max-w-xl"
        action={canResync ? toSource : undefined}
      >
        {canResync ? t.noGraphOwner : t.noGraphGuest}
      </Callout>
    );
  }

  return (
    <Tabs
      label={t.title}
      value={mode}
      onValueChange={(v) =>
        void navigate({ search: (prev) => ({ ...prev, mode: v as 'explore' | 'trace' }) })
      }
      items={[
        { value: 'explore', label: t.explore },
        { value: 'trace', label: t.trace },
      ]}
    >
      <TabPanel value="explore" className="pt-6">
        <Explore repo={repo.id} />
      </TabPanel>
      <TabPanel value="trace" className="pt-6">
        <TraceView repo={repo.id} />
      </TabPanel>
    </Tabs>
  );
}

function Explore({ repo }: { repo: string }) {
  const search = graphRoute.useSearch();
  const { focus } = useGraphNavigation(repo);
  const picked = useSymbolByRef(repo, search.symbol);
  const fromViewer = !search.symbol && search.src === repo && search.path ? search.path : undefined;

  return (
    <div className="flex flex-col gap-8">
      <SymbolCombobox
        repo={repo}
        label={t.search}
        selectedName={picked.data ? `${picked.data.name}  ${picked.data.filePath}` : undefined}
        onPick={focus}
        className="max-w-xl"
      />
      {search.symbol ? (
        <SymbolView repo={repo} symbolRef={search.symbol} />
      ) : fromViewer ? (
        <section aria-labelledby="file-symbols" className="max-w-3xl">
          <SectionHeading id="file-symbols">{t.fileSymbols(fromViewer)}</SectionHeading>
          <FileSymbols repo={repo} path={fromViewer} onPick={focus} />
        </section>
      ) : (
        <Overview repo={repo} />
      )}
    </div>
  );
}
