import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CircuitBreaker, IngestionFailure, ModelUsage, RateLimitUse } from '@/api/types';
import {
  Callout,
  DataTable,
  EmptyState,
  SectionHeading,
  StatusDot,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/ui';
import { ListLoading } from '@/features/account/ListLoading';
import { count, dateTime, duration, usd } from '../format';
import {
  circuitBreakerQuery,
  ingestionFailuresQuery,
  modelsQuery,
  rateLimitsQuery,
  type Window,
} from './queries';

const callTypes: Record<ModelUsage['models'][number]['type'], string> = {
  LLM: 'text',
  EMBEDDING: 'embeddings',
  RERANK: 'rerank',
  WEB_SEARCH: 'web search',
  INGEST: 'ingest',
};

const limitNames: Record<string, string> = {
  messagesHourly: 'Questions per user',
  messagesDaily: 'Questions per user',
  guestMessages: 'Questions per guest',
  guestSignIn: 'New guests per address',
  demoContent: 'Demo source views per address',
  sourceCreate: 'Sources added',
  resync: 'Re-syncs',
  study: 'Study sets',
  search: 'Searches',
  memoryWrites: 'Memory edits',
  webSearch: 'Web searches per user',
  webSearchMonthly: 'Web searches, whole app',
};

const sourceKinds: Record<IngestionFailure['type'], string> = {
  PDF: 'Book',
  GITHUB_REPO: 'Repository',
  WEBSITE: 'Website',
};

/** Which models are being skipped, what the keys spent, what was turned away, what failed to index. */
export function Health({ window }: { window: Window }) {
  return (
    <section aria-labelledby="health" className="min-w-0">
      <SectionHeading id="health" hint="Providers, quotas and sources that need a look.">
        Health
      </SectionHeading>
      <div className="mt-6 flex flex-col gap-10">
        <Breaker />
        <Models window={window} />
        <RateLimits days={window.days} />
        <IngestionFailures system={window.system} />
      </div>
    </section>
  );
}

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h3 className="heading-minor text-ink">{title}</h3>
      {hint && <p className="mt-1 max-w-prose text-xs text-ink-3">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Breaker() {
  const q = useQuery(circuitBreakerQuery);
  return (
    <Block
      title="Models being skipped"
      hint={
        q.data &&
        `A model or key that hits a quota is skipped for ${duration(q.data.coolOffMs)}, or until a daily quota starts over. This is the state of the running server and starts empty after a restart.`
      }
    >
      {q.isPending ? (
        <ListLoading label="Loading model state" rows={1} />
      ) : q.isError ? (
        <Callout error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <BreakerList breaker={q.data} asOf={q.dataUpdatedAt} />
      )}
    </Block>
  );
}

// `asOf` is when the state was read, so the time left is true for that moment and refreshes
// with the query.
function BreakerList({ breaker, asOf }: { breaker: CircuitBreaker; asOf: number }) {
  const open = breaker.models.filter((m) => m.open);
  if (open.length === 0) {
    return <EmptyState className="py-2">No model is being skipped.</EmptyState>;
  }
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {open.map((m) => (
        <li key={m.model} className="flex flex-wrap items-center gap-x-3">
          <StatusDot tone="error" label="Skipped" />
          <span className="font-mono text-xs text-ink">{m.model}</span>
          <span className="text-ink-2">
            back in {m.openUntil ? duration(new Date(m.openUntil).getTime() - asOf) : 'a moment'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Models({ window }: { window: Window }) {
  const q = useQuery(modelsQuery(window));
  const failure = q.isError ? <Callout error={q.error} onRetry={() => void q.refetch()} /> : null;
  const loading = <ListLoading label="Loading model usage" rows={3} />;
  return (
    <>
      <Block
        title="Provider calls by model and key"
        hint="Every call counts: answers, embeddings, reranking and web search."
      >
        {q.isPending ? loading : (failure ?? <ByModel models={q.data!.models} />)}
      </Block>
      <Block title="Provider calls by task">
        {q.isPending ? loading : (failure ?? <ByTask tasks={q.data!.tasks} />)}
      </Block>
    </>
  );
}

function ByModel({ models }: { models: ModelUsage['models'] }) {
  return (
    <DataTable label="Calls by model and key" pinFirstColumn className="min-w-[860px]">
      <THead>
        <TR>
          <TH>Model</TH>
          <TH>Key</TH>
          <TH>Kind</TH>
          <TH className="text-right">Calls</TH>
          <TH className="text-right">Errors</TH>
          <TH className="text-right">Fallbacks</TH>
          <TH className="text-right">Tokens in</TH>
          <TH className="text-right">Tokens out</TH>
          <TH className="text-right">Cost</TH>
        </TR>
      </THead>
      <TBody>
        {models.length === 0 ? (
          <TR>
            <TD colSpan={9} className="text-ink-3">
              No model calls in this range.
            </TD>
          </TR>
        ) : (
          models.map((m) => (
            <TR key={`${m.provider}/${m.model}/${m.key ?? ''}/${m.type}`}>
              <TD className="font-mono text-xs">
                {m.provider}/{m.model}
              </TD>
              <TD className="font-mono text-xs text-ink-2">{m.key ? `#${m.key}` : '—'}</TD>
              <TD className="text-ink-2">{callTypes[m.type]}</TD>
              <TD numeric>{count(m.calls)}</TD>
              <TD numeric className={m.errors > 0 ? 'text-error' : undefined}>
                {count(m.errors)}
              </TD>
              <TD numeric>{count(m.fallbacks)}</TD>
              <TD numeric>{count(m.tokensIn)}</TD>
              <TD numeric>{count(m.tokensOut)}</TD>
              <TD numeric>{usd(m.costUsd)}</TD>
            </TR>
          ))
        )}
      </TBody>
    </DataTable>
  );
}

function ByTask({ tasks }: { tasks: ModelUsage['tasks'] }) {
  return (
    <DataTable label="Calls by task" className="min-w-[640px]">
      <THead>
        <TR>
          <TH>Task</TH>
          <TH className="text-right">Calls</TH>
          <TH className="text-right">Errors</TH>
          <TH className="text-right">Fallbacks</TH>
          <TH className="text-right">Tokens in</TH>
          <TH className="text-right">Tokens out</TH>
          <TH className="text-right">Cost</TH>
        </TR>
      </THead>
      <TBody>
        {tasks.length === 0 ? (
          <TR>
            <TD colSpan={7} className="text-ink-3">
              No model calls in this range.
            </TD>
          </TR>
        ) : (
          tasks.map((t) => (
            <TR key={t.task}>
              <TD>{t.task}</TD>
              <TD numeric>{count(t.calls)}</TD>
              <TD numeric className={t.errors > 0 ? 'text-error' : undefined}>
                {count(t.errors)}
              </TD>
              <TD numeric>{count(t.fallbacks)}</TD>
              <TD numeric>{count(t.tokensIn)}</TD>
              <TD numeric>{count(t.tokensOut)}</TD>
              <TD numeric>{usd(t.costUsd)}</TD>
            </TR>
          ))
        )}
      </TBody>
    </DataTable>
  );
}

function windowText(limit: RateLimitUse['limits'][number]) {
  const { points, windowSec } = limit;
  if (windowSec === null) return `${count(points)} a month`;
  if (windowSec === 60) return `${count(points)} a minute`;
  if (windowSec === 3600) return `${count(points)} an hour`;
  if (windowSec === 86400) return `${count(points)} a day`;
  return `${count(points)} per ${duration(windowSec * 1000)}`;
}

function RateLimits({ days }: { days: Window['days'] }) {
  const q = useQuery(rateLimitsQuery({ days }));
  return (
    <Block
      title="Rate limits"
      hint="What each limit counted and turned away. Counters are kept for about two days, so a long range may look empty."
    >
      {q.isPending ? (
        <ListLoading label="Loading rate limits" rows={3} />
      ) : q.isError ? (
        <Callout error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable label="Rate limits" className="min-w-[640px]">
          <THead>
            <TR>
              <TH>Limit</TH>
              <TH>Allows</TH>
              <TH className="text-right">Requests</TH>
              <TH className="text-right">Turned away</TH>
              <TH className="text-right">Clients</TH>
            </TR>
          </THead>
          <TBody>
            {q.data.limits.map((l) => (
              <TR key={l.name}>
                <TD>{limitNames[l.name] ?? l.name}</TD>
                <TD className="text-ink-2">{windowText(l)}</TD>
                <TD numeric>{count(l.requests)}</TD>
                <TD numeric className={l.blocked > 0 ? 'text-error' : undefined}>
                  {count(l.blocked)}
                </TD>
                <TD numeric>{count(l.clientsBlocked)}</TD>
              </TR>
            ))}
          </TBody>
        </DataTable>
      )}
    </Block>
  );
}

function IngestionFailures({ system }: { system: boolean }) {
  const q = useQuery(ingestionFailuresQuery({ system }));
  return (
    <Block title="Sources that failed to index" hint="The latest 20, newest first.">
      {q.isPending ? (
        <ListLoading label="Loading failed sources" rows={2} />
      ) : q.isError ? (
        <Callout error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState className="py-2">No source has failed to index.</EmptyState>
      ) : (
        <DataTable label="Sources that failed to index" className="min-w-[720px]">
          <THead>
            <TR>
              <TH>Source</TH>
              <TH>Stopped at</TH>
              <TH>Error</TH>
              <TH>When</TH>
            </TR>
          </THead>
          <TBody>
            {q.data.map((f) => (
              <TR key={f.sourceId}>
                <TD className="max-w-[18rem]">
                  <span className="line-clamp-2 break-words text-ink">{f.title}</span>
                  <span className="text-xs text-ink-3">{sourceKinds[f.type]}</span>
                </TD>
                <TD className="whitespace-nowrap text-ink-2">{f.stage.toLowerCase()}</TD>
                <TD className="max-w-[26rem] break-words text-xs text-error">{f.error ?? '—'}</TD>
                <TD className="whitespace-nowrap text-xs text-ink-3">{dateTime(f.failedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </DataTable>
      )}
    </Block>
  );
}
