import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEvalDatasets, useEvalRuns } from '@/api/queries';
import type { EvalRun } from '@/api/types';
import { Button, ChipButton, ProgressRule, Table, TBody, TD, TH, THead, TR } from '@/ui';
import { RouteError } from '@/ui/RouteError';
import { Sparkline } from '../charts/Sparkline';
import { relative, usd } from '../format';
import { ScrollTable } from '../ScrollTable';
import { strings } from '../strings';
import { headlineFor, num, runColumns, typeLabel } from './metrics';
import { RunStatus } from './RunStatus';
import { StartRunDialog } from './StartRunDialog';

/** Datasets, then every run newest first, with a suite filter and two-run compare. */
export function RunsPage() {
  const navigate = useNavigate();
  const [suite, setSuite] = useState<string | undefined>();
  const [picked, setPicked] = useState<EvalRun[]>([]);
  const [starting, setStarting] = useState(false);
  const datasets = useEvalDatasets();
  const runs = useEvalRuns({ suite, limit: 100 });

  const suites = useMemo(
    () => [...new Set((runs.data ?? []).map((r) => r.suite))].sort(),
    [runs.data],
  );

  // One headline trend per suite, oldest to newest, finished runs only.
  const trends = useMemo(() => {
    const out: { suite: string; values: number[] }[] = [];
    for (const s of suites) {
      const key = headlineFor(s).key;
      const values = (runs.data ?? [])
        .filter((r) => r.suite === s && r.status === 'DONE')
        .map((r) => num(r.overall?.[key]))
        .filter((v): v is number => v !== null)
        .slice(0, 12)
        .reverse();
      out.push({ suite: s, values });
    }
    return out;
  }, [runs.data, suites]);

  const toggle = (run: EvalRun) =>
    setPicked((cur) =>
      cur.some((r) => r.id === run.id)
        ? cur.filter((r) => r.id !== run.id)
        : [...cur, run].slice(-2),
    );
  const canPick = (run: EvalRun) =>
    picked.length === 0 ||
    picked.some((r) => r.id === run.id) ||
    (picked[0]!.suite === run.suite && picked[0]!.dataset === run.dataset);

  if (runs.error) return <RouteError error={runs.error} reset={() => void runs.refetch()} />;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="datasets">
        <h2 id="datasets" className="mb-2 text-sm font-medium text-ink">
          {strings.evals.datasets}
        </h2>
        {datasets.data?.length === 0 ? (
          <p className="text-sm text-ink-3">{strings.evals.noDatasets}</p>
        ) : (
          <dl className="divide-y divide-rule border-y border-rule">
            {(datasets.data ?? []).map((d) => (
              <div key={d.id} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-2.5">
                <dt className="min-w-32 font-mono text-sm text-ink">{d.name}</dt>
                <dd className="m-0 text-sm text-ink-2">
                  {d.cases} cases
                  <span className="ml-3 font-mono text-xs text-ink-3">
                    {Object.entries(d.bySplit)
                      .map(([k, v]) => `${k.toLowerCase()} ${v}`)
                      .join(' · ')}
                  </span>
                  <span className="ml-3 font-mono text-xs text-ink-3">
                    {Object.entries(d.byType)
                      .map(([k, v]) => `${typeLabel(k)} ${v}`)
                      .join(' · ')}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="runs" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="runs" className="text-sm font-medium text-ink">
            {strings.evals.runs}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={picked.length !== 2}
              title={picked.length !== 2 ? strings.evals.compareHint : undefined}
              onClick={() =>
                void navigate({
                  to: '/admin/evals/compare',
                  search: { a: picked[0]!.id, b: picked[1]!.id },
                })
              }
            >
              {strings.evals.compare}
              {picked.length > 0 && <span className="font-mono text-ink-3">{picked.length}/2</span>}
            </Button>
            <Button size="sm" onClick={() => setStarting(true)}>
              {strings.evals.start}
            </Button>
          </div>
        </div>

        <div
          className="mb-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by suite"
        >
          <ChipButton pressed={!suite} onClick={() => setSuite(undefined)}>
            {strings.evals.allSuites}
          </ChipButton>
          {(suite ? [suite] : suites).map((s) => (
            <ChipButton
              key={s}
              pressed={suite === s}
              onClick={() => setSuite(suite === s ? undefined : s)}
            >
              {s}
            </ChipButton>
          ))}
          <span className="ml-auto flex flex-wrap items-center gap-4">
            {trends
              .filter((t) => t.values.length > 1)
              .map((t) => (
                <span key={t.suite} className="inline-flex items-center gap-2 text-xs text-ink-3">
                  <span className="font-mono">
                    {t.suite} {headlineFor(t.suite).label}
                  </span>
                  <Sparkline
                    values={t.values}
                    label={`${t.suite} ${headlineFor(t.suite).label} over the last ${t.values.length} runs, latest ${t.values.at(-1)!.toFixed(3)}`}
                  />
                  <span className="font-mono text-ink-2">{t.values.at(-1)!.toFixed(3)}</span>
                </span>
              ))}
          </span>
        </div>

        {runs.isPending && <ProgressRule label="Loading runs" />}
        {runs.data?.length === 0 ? (
          <p className="py-6 text-sm text-ink-3">{strings.evals.noRuns}</p>
        ) : (
          runs.data && (
            <ScrollTable>
              <Table stickyHeader>
                <THead>
                  <TR>
                    <TH>Run</TH>
                    <TH>Suite</TH>
                    <TH>Status</TH>
                    <TH className="text-right">recall@5</TH>
                    <TH className="text-right">MRR</TH>
                    <TH className="text-right">faithfulness</TH>
                    <TH className="text-right">citation acc.</TH>
                    <TH className="text-right">latency p50</TH>
                    <TH className="text-right">cost</TH>
                    <TH>Started</TH>
                  </TR>
                </THead>
                <TBody>
                  {runs.data.map((run) => {
                    const c = runColumns(run.overall);
                    const isPicked = picked.some((r) => r.id === run.id);
                    return (
                      <TR key={run.id} className={isPicked ? 'bg-accent-wash' : undefined}>
                        <TD>
                          <span className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isPicked}
                              disabled={!canPick(run)}
                              onChange={() => toggle(run)}
                              aria-label={`Pick ${run.name} to compare`}
                              className="size-4 accent-[var(--accent)]"
                            />
                            <Link
                              to="/admin/evals/$runId"
                              params={{ runId: run.id }}
                              className="font-mono text-xs text-ink hover:text-accent hover:underline"
                            >
                              {run.name}
                            </Link>
                          </span>
                        </TD>
                        <TD className="font-mono text-xs text-ink-2">
                          {run.suite}
                          <span className="ml-1.5 text-ink-3">
                            {run.dataset}/{run.split.toLowerCase()}
                          </span>
                        </TD>
                        <TD>
                          <RunStatus status={run.status} />
                        </TD>
                        <TD numeric>{c.recall5}</TD>
                        <TD numeric>{c.mrr}</TD>
                        <TD numeric>{c.faithfulness}</TD>
                        <TD numeric>{c.citations}</TD>
                        <TD numeric>{c.latency}</TD>
                        <TD numeric>{usd(run.costUsd)}</TD>
                        <TD className="whitespace-nowrap text-xs text-ink-3" title={run.startedAt}>
                          {relative(run.startedAt)}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </ScrollTable>
          )
        )}
      </section>

      <StartRunDialog open={starting} onOpenChange={setStarting} />
    </div>
  );
}
