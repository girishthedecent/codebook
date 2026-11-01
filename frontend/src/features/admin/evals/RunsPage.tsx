import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEvalDatasets, useEvalRuns } from '@/api/queries';
import type { EvalRun } from '@/api/types';
import {
  Button,
  Callout,
  Checkbox,
  ChipButton,
  DataTable,
  EmptyState,
  SectionHeading,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextLink,
  VisuallyHidden,
} from '@/ui';
import { ListLoading } from '@/features/account/ListLoading';
import { Sparkline } from '../charts/Sparkline';
import { relative, usd } from '../format';
import { strings } from '../strings';
import { headlineFor, num, runColumnsFor, typeLabel } from './metrics';
import { RunStatus } from './RunStatus';
import { StartRunDialog } from './StartRunDialog';
import { evalsStatusQuery } from './status';

const t = strings.evals;

// The pinned first cell is opaque paper; a picked row lays its wash over that colour.
const pickedFirstCell = 'bg-[linear-gradient(var(--accent-wash),var(--accent-wash))]';

/** Datasets, then every run newest first, with a suite filter and two-run compare. */
export function RunsPage() {
  const navigate = useNavigate();
  const [suite, setSuite] = useState<string | undefined>();
  const [picked, setPicked] = useState<EvalRun[]>([]);
  const [starting, setStarting] = useState(false);
  const datasets = useEvalDatasets();
  const runs = useEvalRuns({ suite, limit: 100 });
  const status = useQuery(evalsStatusQuery);
  // A server that doesn't answer the status question is treated as able; the POST says no itself.
  const canStart = status.data ? status.data.canStartRuns : !status.isPending;

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

  const columns = suite ? runColumnsFor(suite) : null;
  const compareText =
    picked.length === 2 ? t.compareReady : picked.length === 1 ? t.compareOne : t.compareHint;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="datasets">
        <SectionHeading id="datasets">{t.datasets}</SectionHeading>
        {datasets.isPending ? (
          <ListLoading label="Loading datasets" rows={2} />
        ) : datasets.error ? (
          <Callout error={datasets.error} onRetry={() => void datasets.refetch()} />
        ) : datasets.data.length === 0 ? (
          <EmptyState className="py-2">{t.noDatasets}</EmptyState>
        ) : (
          <DataTable label={t.datasets} className="min-w-[560px]">
            <THead>
              <TR>
                <TH>Name</TH>
                <TH className="text-right">Cases</TH>
                <TH>Splits</TH>
                <TH>Case types</TH>
              </TR>
            </THead>
            <TBody>
              {datasets.data.map((d) => (
                <TR key={d.id}>
                  <TD>{d.name}</TD>
                  <TD numeric>{d.cases}</TD>
                  <TD className="text-xs text-ink-2">
                    {Object.entries(d.bySplit)
                      .map(([k, v]) => `${k.toLowerCase()} ${v}`)
                      .join(', ')}
                  </TD>
                  <TD className="text-xs text-ink-2">
                    {Object.entries(d.byType)
                      .map(([k, v]) => `${typeLabel(k)} ${v}`)
                      .join(', ')}
                  </TD>
                </TR>
              ))}
            </TBody>
          </DataTable>
        )}
      </section>

      <section aria-labelledby="runs" className="min-w-0">
        <SectionHeading id="runs">{t.runs}</SectionHeading>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p id="compare-hint" className="max-w-prose text-xs text-ink-3">
            {compareText}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={picked.length !== 2}
              aria-describedby="compare-hint"
              onClick={() =>
                void navigate({
                  to: '/admin/evals/compare',
                  search: { a: picked[0]!.id, b: picked[1]!.id },
                })
              }
            >
              {t.compare}
              {picked.length > 0 && (
                <span className="tabular-nums text-ink-3">{picked.length}/2</span>
              )}
            </Button>
            <Button
              variant="primary"
              disabled={!canStart}
              aria-describedby={canStart ? undefined : 'start-reason'}
              onClick={() => setStarting(true)}
            >
              {t.start}
            </Button>
          </div>
        </div>
        {!canStart && !status.isPending && (
          <Callout tone="warn" className="mb-4">
            <span id="start-reason">{status.data?.reason ?? t.cantStart}</span>
          </Callout>
        )}

        <div
          className="mb-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by suite"
        >
          <ChipButton pressed={!suite} onClick={() => setSuite(undefined)}>
            {t.allSuites}
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
              .filter((tr) => tr.values.length > 1)
              .map((tr) => (
                <span key={tr.suite} className="inline-flex items-center gap-2 text-xs text-ink-3">
                  <span>
                    {tr.suite} {headlineFor(tr.suite).label}
                  </span>
                  <Sparkline
                    values={tr.values}
                    label={`${tr.suite} ${headlineFor(tr.suite).label} over the last ${tr.values.length} runs, latest ${tr.values.at(-1)!.toFixed(3)}`}
                  />
                  <span className="tabular-nums text-ink-2">{tr.values.at(-1)!.toFixed(3)}</span>
                </span>
              ))}
          </span>
        </div>

        {runs.error && !runs.data && (
          <Callout error={runs.error} onRetry={() => void runs.refetch()} />
        )}
        {runs.isPending && !runs.error && <ListLoading label="Loading runs" rows={5} />}
        {runs.data?.length === 0 ? (
          <EmptyState>{t.noRuns}</EmptyState>
        ) : (
          runs.data && (
            <DataTable label="Evaluation runs" pinFirstColumn className="min-w-[760px]">
              <THead>
                <TR>
                  <TH>Run</TH>
                  {!columns && <TH>Suite</TH>}
                  <TH>Status</TH>
                  {columns ? (
                    columns.map((c) => (
                      <TH key={c.key} className="text-right">
                        {c.label}
                      </TH>
                    ))
                  ) : (
                    <TH className="text-right">Headline score</TH>
                  )}
                  <TH className="text-right">Cost</TH>
                  <TH>Started</TH>
                </TR>
              </THead>
              <TBody>
                {runs.data.map((run) => {
                  const isPicked = picked.some((r) => r.id === run.id);
                  const head = headlineFor(run.suite);
                  return (
                    <TR key={run.id} className={isPicked ? 'bg-accent-wash' : undefined}>
                      <TD className={isPicked ? pickedFirstCell : undefined}>
                        <span className="flex items-start gap-1">
                          <Checkbox
                            className="-my-2"
                            checked={isPicked}
                            disabled={!canPick(run)}
                            onCheckedChange={() => toggle(run)}
                            label={<VisuallyHidden>Pick {run.name} to compare</VisuallyHidden>}
                          />
                          <span className="min-w-0">
                            <TextLink
                              to="/admin/evals/$runId"
                              params={{ runId: run.id }}
                              className="break-words"
                            >
                              {run.name}
                            </TextLink>
                            <span className="block text-xs text-ink-3">
                              {run.dataset}, {run.split.toLowerCase()}
                            </span>
                          </span>
                        </span>
                      </TD>
                      {!columns && <TD className="text-ink-2">{run.suite}</TD>}
                      <TD>
                        <RunStatus status={run.status} />
                      </TD>
                      {columns ? (
                        columns.map((c) => (
                          <TD key={c.key} numeric>
                            {c.format(run.overall?.[c.key])}
                          </TD>
                        ))
                      ) : (
                        <TD numeric>
                          {head.format(run.overall?.[head.key])}
                          <span className="ml-1.5 font-sans text-ink-3">{head.label}</span>
                        </TD>
                      )}
                      <TD numeric>{usd(run.costUsd)}</TD>
                      <TD className="whitespace-nowrap text-xs text-ink-3">
                        <time dateTime={run.startedAt}>{relative(run.startedAt)}</time>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </DataTable>
          )
        )}
      </section>

      <StartRunDialog open={starting} onOpenChange={setStarting} />
    </div>
  );
}
