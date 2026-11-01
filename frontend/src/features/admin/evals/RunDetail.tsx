import { useState } from 'react';
import { useEvalResults, useEvalRun } from '@/api/queries';
import {
  BackLink,
  Callout,
  ChipButton,
  EmptyState,
  ProgressRule,
  SectionHeading,
  Stat,
  Stats,
} from '@/ui';
import { ListLoading } from '@/features/account/ListLoading';
import { BarChart } from '../charts/BarChart';
import { dateTime, ms, usd } from '../format';
import { strings } from '../strings';
import { headlineFor, isRecord, metricsFor, num, typeLabel } from './metrics';
import { ResultsTable } from './ResultsTable';
import { RunStatus } from './RunStatus';

/** One run: what it measured, the numbers, how each case type did, then every case. */
export function RunDetail({ runId }: { runId: string }) {
  const run = useEvalRun(runId);
  const [failedOnly, setFailedOnly] = useState(false);
  const results = useEvalResults(
    runId,
    failedOnly ? { failed: 'true' } : {},
    run.data?.status === 'RUNNING',
  );

  if (run.error && !run.data)
    return (
      <div>
        <BackLink to="/admin/evals">{strings.evals.runs}</BackLink>
        <Callout error={run.error} onRetry={() => void run.refetch()} className="mt-4" />
      </div>
    );
  if (!run.data)
    return (
      <div>
        <BackLink to="/admin/evals">{strings.evals.runs}</BackLink>
        <ListLoading label="Loading run" rows={3} className="mt-4" />
      </div>
    );

  const r = run.data;
  const summary = isRecord(r.summary) ? r.summary : {};
  const overall = r.overall ?? {};
  const latency = isRecord(summary.latency) ? summary.latency : null;
  const byType = isRecord(summary.byType) ? summary.byType : {};
  const head = headlineFor(r.suite);
  const types = Object.keys(byType).sort();

  const figures = metricsFor(r.suite)
    .filter((m) => overall[m.key] !== undefined && overall[m.key] !== null)
    .slice(0, 5)
    .map((m) => ({ label: m.label, value: m.format(overall[m.key]) }));
  const errors = num(overall.errors);

  const facts: [string, string | null | undefined, boolean?][] = [
    ['dataset', `${r.dataset}, ${r.split.toLowerCase()}`],
    ['started', dateTime(r.startedAt)],
    ['finished', r.finishedAt ? dateTime(r.finishedAt) : null],
    ['commit', r.gitSha?.slice(0, 7), true],
    [
      'models',
      isRecord(r.models)
        ? Object.values(r.models)
            .filter((v) => typeof v === 'string')
            .join(', ')
        : null,
      true,
    ],
    ['prompts', Array.isArray(r.promptVersions) ? r.promptVersions.join(', ') : null, true],
  ];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <BackLink to="/admin/evals">{strings.evals.runs}</BackLink>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="heading-page break-words">{r.name}</h2>
          <span className="text-sm text-ink-2">{r.suite} suite</span>
          <RunStatus status={r.status} />
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          {facts
            .filter(([, v]) => v)
            .map(([k, v, mono]) => (
              <div key={k} className="flex gap-1.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className={mono ? 'm-0 font-mono text-ink-2' : 'm-0 text-ink-2'}>{v}</dd>
              </div>
            ))}
        </dl>
        {r.notes && <p className="mt-3 max-w-prose text-sm text-ink-2">{r.notes}</p>}
        {r.status === 'RUNNING' && <ProgressRule label="Run in progress" className="mt-3" />}
      </header>

      {(figures.length > 0 || latency) && (
        <Stats>
          {figures.map((f) => (
            <Stat key={f.label} label={f.label} value={f.value} />
          ))}
          {latency && (
            <Stat label="latency p50 / p95" value={`${ms(latency.p50)} / ${ms(latency.p95)}`} />
          )}
          <Stat label="cost" value={usd(r.costUsd)} />
          {errors ? <Stat label="errors" value={String(errors)} tone="error" /> : null}
        </Stats>
      )}

      {types.length > 0 && (
        <BarChart
          title={`${head.label} by case type`}
          x={types}
          values={types.map((t) => num(isRecord(byType[t]) ? byType[t][head.key] : null))}
          label={head.label}
          formatX={typeLabel}
          formatY={(v) => (v === 0 || v === 1 ? String(v) : v.toFixed(2))}
          max={1}
        />
      )}

      <section aria-labelledby="cases" className="min-w-0">
        <SectionHeading
          as="h3"
          id="cases"
          hint={results.data ? `${results.data.length} cases` : undefined}
          actions={
            <ChipButton pressed={failedOnly} onClick={() => setFailedOnly((v) => !v)}>
              {strings.evals.failedOnly}
            </ChipButton>
          }
        >
          Cases
        </SectionHeading>
        {results.isPending ? (
          <ListLoading label="Loading results" rows={4} />
        ) : results.error ? (
          <Callout error={results.error} onRetry={() => void results.refetch()} />
        ) : results.data.length === 0 ? (
          <EmptyState>{failedOnly ? strings.evals.noFailed : strings.evals.noResults}</EmptyState>
        ) : (
          <div className={results.isFetching ? 'opacity-60' : undefined}>
            <ResultsTable results={results.data} />
          </div>
        )}
      </section>
    </div>
  );
}
