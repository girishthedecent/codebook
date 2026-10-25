import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useEvalResults, useEvalRun } from '@/api/queries';
import { ChipButton, ProgressRule } from '@/ui';
import { RouteError } from '@/ui/RouteError';
import { BarChart } from '../charts/BarChart';
import { Figures, type Figure } from '../Figures';
import { dateTime, ms, usd } from '../format';
import { strings } from '../strings';
import { headlineFor, isRecord, metricsFor, num, typeLabel } from './metrics';
import { ResultsTable } from './ResultsTable';
import { RunStatus } from './RunStatus';

/** One run: what it measured, the numbers, how each case type did, then every case. */
export function RunDetail({ runId }: { runId: string }) {
  const run = useEvalRun(runId);
  const [failedOnly, setFailedOnly] = useState(false);
  const results = useEvalResults(runId, failedOnly ? { failed: 'true' } : {});

  if (run.error) return <RouteError error={run.error} reset={() => void run.refetch()} />;
  if (!run.data) return <ProgressRule label="Loading run" />;

  const r = run.data;
  const summary = isRecord(r.summary) ? r.summary : {};
  const overall = r.overall ?? {};
  const latency = isRecord(summary.latency) ? summary.latency : null;
  const byType = isRecord(summary.byType) ? summary.byType : {};
  const head = headlineFor(r.suite);
  const types = Object.keys(byType).sort();

  const figures: Figure[] = metricsFor(r.suite)
    .filter((m) => overall[m.key] !== undefined && overall[m.key] !== null)
    .slice(0, 5)
    .map((m) => ({ label: m.label, value: m.format(overall[m.key]) }));
  if (latency)
    figures.push({ label: 'latency p50 / p95', value: `${ms(latency.p50)} / ${ms(latency.p95)}` });
  figures.push({ label: 'cost', value: usd(r.costUsd) });
  const errors = num(overall.errors);
  if (errors) figures.push({ label: 'errors', value: String(errors), tone: 'error' });

  const facts: [string, string | null | undefined][] = [
    ['dataset', `${r.dataset}/${r.split.toLowerCase()}`],
    ['started', dateTime(r.startedAt)],
    ['finished', r.finishedAt ? dateTime(r.finishedAt) : null],
    ['commit', r.gitSha?.slice(0, 7)],
    [
      'models',
      isRecord(r.models)
        ? Object.values(r.models)
            .filter((v) => typeof v === 'string')
            .join(', ')
        : null,
    ],
    ['prompts', Array.isArray(r.promptVersions) ? r.promptVersions.join(', ') : null],
  ];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link to="/admin/evals" className="text-xs text-ink-3 hover:text-ink">
          ← {strings.evals.runs}
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-mono text-lg font-medium text-ink">{r.name}</h2>
          <span className="font-mono text-sm text-ink-3">{r.suite}</span>
          <RunStatus status={r.status} />
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className="m-0 font-mono text-ink-2">{v}</dd>
              </div>
            ))}
        </dl>
        {r.notes && <p className="mt-2 max-w-[70ch] text-sm text-ink-2">{r.notes}</p>}
        {r.status === 'RUNNING' && <ProgressRule label="Run in progress" className="mt-3" />}
      </header>

      {figures.length > 0 && <Figures items={figures} />}

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
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="cases" className="text-sm font-medium text-ink">
            Cases
            {results.data && (
              <span className="ml-2 font-mono text-xs text-ink-3">{results.data.length}</span>
            )}
          </h3>
          <ChipButton pressed={failedOnly} onClick={() => setFailedOnly((v) => !v)}>
            {strings.evals.failedOnly}
          </ChipButton>
        </div>
        {results.isPending ? (
          <ProgressRule label="Loading results" />
        ) : results.error ? (
          <RouteError error={results.error} reset={() => void results.refetch()} />
        ) : results.data.length === 0 ? (
          <p className="py-4 text-sm text-ink-3">
            {failedOnly ? strings.evals.noFailed : strings.evals.noResults}
          </p>
        ) : (
          <div className={results.isFetching ? 'opacity-60' : undefined}>
            <ResultsTable results={results.data} />
          </div>
        )}
      </section>
    </div>
  );
}
