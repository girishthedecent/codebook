import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { ChipButton, ProgressRule, Table, TBody, TD, TH, THead, TR } from '@/ui';
import { RouteError } from '@/ui/RouteError';
import { BarChart } from '../charts/BarChart';
import { LineChart } from '../charts/LineChart';
import { Figures } from '../Figures';
import { day, ms, pct, usd } from '../format';
import { ScrollTable } from '../ScrollTable';
import { strings } from '../strings';
import { FailedQueries } from './FailedQueries';
import { RANGES, type RangeDays } from './ranges';

const DAY = 24 * 60 * 60 * 1000;

// Keyed by the range, not by timestamps: the window is "the last N days" as of each fetch.
function lastDaysStats(days: RangeDays) {
  return {
    queryKey: ['monitoring', 'stats', 'last', days] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const to = new Date();
      const from = new Date(to.getTime() - days * DAY);
      return unwrap(
        api.GET('/api/v1/monitoring/stats', {
          params: { query: { from: from.toISOString(), to: to.toISOString() } },
          signal,
        }),
      );
    },
    staleTime: 60_000,
  };
}

type DayRow = { day: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number };

function toDayRows(rows: Record<string, unknown>[]): DayRow[] {
  return rows.map((r) => ({
    day: String(r.day),
    calls: Number(r.calls) || 0,
    tokensIn: Number(r.tokensIn) || 0,
    tokensOut: Number(r.tokensOut) || 0,
    costUsd: Number(r.costUsd) || 0,
  }));
}

/**
 * Answer quality and latency, model usage per day, providers and ingestion over one date
 * range, then the answers that failed. The range scopes everything on the page.
 */
export function MonitoringPage({
  range,
  onRange,
}: {
  range: RangeDays;
  onRange: (r: RangeDays) => void;
}) {
  const stats = useQuery({ ...lastDaysStats(range), placeholderData: keepPreviousData });

  if (stats.error) return <RouteError error={stats.error} reset={() => void stats.refetch()} />;

  const s = stats.data;
  const days = s ? toDayRows(s.usagePerDay) : [];
  const x = days.map((d) => d.day);

  return (
    <div className="flex flex-col gap-10">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={strings.monitoring.range}
      >
        <span className="mr-1 text-xs text-ink-3">{strings.monitoring.range}</span>
        {RANGES.map((r) => (
          <ChipButton key={r} pressed={range === r} onClick={() => onRange(r)}>
            Last {r} days
          </ChipButton>
        ))}
      </div>

      {!s ? (
        <ProgressRule label="Loading stats" />
      ) : (
        <div
          className={stats.isFetching ? 'flex flex-col gap-10 opacity-60' : 'flex flex-col gap-10'}
        >
          <section aria-labelledby="answers">
            <h2 id="answers" className="mb-3 text-sm font-medium text-ink">
              Answers
            </h2>
            <Figures
              items={[
                { label: 'answers', value: s.answers.count.toLocaleString() },
                {
                  label: 'latency p50 / p95',
                  value: `${ms(s.answers.latencyMs.p50)} / ${ms(s.answers.latencyMs.p95)}`,
                },
                { label: 'first token p50', value: ms(s.answers.firstTokenMs.p50) },
                { label: 'retrieval p50', value: ms(s.answers.retrievalMs.p50) },
                {
                  label: 'errors',
                  value: pct(s.answers.errorRate),
                  tone: (s.answers.errorRate ?? 0) > 0.05 ? 'error' : undefined,
                },
              ]}
            />
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {(
                [
                  ['not helpful', s.answers.thumbsDownRate, 'of rated answers'],
                  ['bad citations', s.answers.invalidCitationRate, 'of answers'],
                  ['weak retrieval', s.answers.weakRetrievalRate, 'of answers'],
                ] as const
              ).map(([label, v, of]) => (
                <div key={label} className="flex gap-1.5">
                  <dt className="text-ink-3">{label}</dt>
                  <dd className="m-0 font-mono text-ink-2">
                    {pct(v)} <span className="font-sans text-ink-3">{of}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-label="Usage per day" className="grid min-w-0 gap-10 lg:grid-cols-2">
            <LineChart
              title={strings.monitoring.calls}
              x={x}
              formatX={day}
              area
              series={[
                {
                  key: 'calls',
                  label: 'calls',
                  color: 'var(--series-1)',
                  values: days.map((d) => d.calls),
                },
              ]}
            />
            <BarChart
              title={strings.monitoring.cost}
              x={x}
              formatX={day}
              values={days.map((d) => d.costUsd)}
              label="cost"
              formatY={(v) => usd(v)}
            />
            <div className="lg:col-span-2">
              <LineChart
                title={strings.monitoring.tokens}
                x={x}
                formatX={day}
                series={[
                  {
                    key: 'in',
                    label: 'tokens in',
                    color: 'var(--series-1)',
                    values: days.map((d) => d.tokensIn),
                  },
                  {
                    key: 'out',
                    label: 'tokens out',
                    color: 'var(--series-2)',
                    values: days.map((d) => d.tokensOut),
                  },
                ]}
              />
            </div>
          </section>

          <section aria-labelledby="providers" className="grid min-w-0 gap-10 lg:grid-cols-2">
            <div className="min-w-0">
              <h2 id="providers" className="mb-1 text-sm font-medium text-ink">
                {strings.monitoring.providers}
              </h2>
              <p className="mb-3 font-mono text-xs text-ink-3">
                fallbacks {pct(s.providers.fallbackRate)} · errors {pct(s.providers.errorRate)}
              </p>
              <ScrollTable className="[&_table]:min-w-[420px]">
                <Table>
                  <THead>
                    <TR>
                      <TH>Provider</TH>
                      <TH className="text-right">calls</TH>
                      <TH className="text-right">errors</TH>
                      <TH className="text-right">fallbacks</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {s.providers.byProvider.length === 0 ? (
                      <TR>
                        <TD colSpan={4} className="text-ink-3">
                          No model calls in this range.
                        </TD>
                      </TR>
                    ) : (
                      s.providers.byProvider.map((p) => (
                        <TR key={p.provider}>
                          <TD className="font-mono text-xs">{p.provider}</TD>
                          <TD numeric>{p.calls.toLocaleString()}</TD>
                          <TD numeric>{pct(p.errorRate)}</TD>
                          <TD numeric>{pct(p.fallbackRate)}</TD>
                        </TR>
                      ))
                    )}
                  </TBody>
                </Table>
              </ScrollTable>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-medium text-ink">Ingestion</h2>
              <Figures
                items={[
                  { label: 'ready', value: String(s.ingestion.ready) },
                  {
                    label: 'failed',
                    value: String(s.ingestion.failed),
                    tone: s.ingestion.failed > 0 ? 'error' : undefined,
                  },
                  { label: 'in progress', value: String(s.ingestion.inProgress) },
                  { label: 'success', value: pct(s.ingestion.successRate) },
                  {
                    label: 'average time',
                    value:
                      s.ingestion.avgSeconds === null ? '—' : ms(s.ingestion.avgSeconds * 1000),
                  },
                ]}
              />
            </div>
          </section>
        </div>
      )}

      <FailedQueries />
    </div>
  );
}
