import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Callout,
  ChipButton,
  DataTable,
  SectionHeading,
  Stat,
  Stats,
  Switch,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextButton,
} from '@/ui';
import { cn } from '@/lib/cn';
import { ListLoading } from '@/features/account/ListLoading';
import { BarChart } from '../charts/BarChart';
import { LineChart } from '../charts/LineChart';
import { clock, count, day, ms, pct, usd } from '../format';
import { strings } from '../strings';
import { FailedQueries } from './FailedQueries';
import { Health } from './Health';
import { statsQuery } from './queries';
import { RANGES, type RangeDays } from './ranges';

const t = strings.monitoring;

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

/** "p50 / p95" of a latency, from the two numbers the stats return. */
function pair(v: { p50: number | null; p95: number | null }) {
  return `${ms(v.p50)} / ${ms(v.p95)}`;
}

/**
 * Answer quality and latency, provider calls per day, ingestion and health over one date
 * range, then the answers that failed. The range scopes the numbers above the failed answers.
 */
export function MonitoringPage({
  range,
  onRange,
  system,
  onSystem,
}: {
  range: RangeDays;
  onRange: (r: RangeDays) => void;
  system: boolean;
  onSystem: (on: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const win = { days: range, system };
  const stats = useQuery({ ...statsQuery(win), placeholderData: keepPreviousData });

  const s = stats.data;
  const days = s ? toDayRows(s.usagePerDay) : [];
  const x = days.map((d) => d.day);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.range}>
          <span className="mr-1 text-xs text-ink-3">{t.range}</span>
          {RANGES.map((r) => (
            <ChipButton key={r} pressed={range === r} onClick={() => onRange(r)}>
              Last {r} days
            </ChipButton>
          ))}
        </div>
        <Switch
          checked={system}
          onCheckedChange={onSystem}
          label={t.system}
          description={t.systemHint}
        />
        {stats.dataUpdatedAt > 0 && (
          <p className="text-xs text-ink-3 sm:ml-auto">
            {t.asOf(clock(stats.dataUpdatedAt))}
            {' · '}
            <TextButton
              className="py-2"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['monitoring'] })}
            >
              {t.refresh}
            </TextButton>
          </p>
        )}
      </div>

      {stats.error && <Callout error={stats.error} onRetry={() => void stats.refetch()} />}

      {!s ? (
        stats.error ? null : (
          <ListLoading label="Loading stats" rows={4} />
        )
      ) : (
        <div className={cn('flex flex-col gap-10', stats.isFetching && 'opacity-60')}>
          <section aria-labelledby="answers">
            <SectionHeading id="answers">Answers</SectionHeading>
            <Stats>
              <Stat label="answers" value={count(s.answers.count)} />
              <Stat label="latency p50 / p95" value={pair(s.answers.latencyMs)} />
              <Stat label="first token p50 / p95" value={pair(s.answers.firstTokenMs)} />
              <Stat label="retrieval p50 / p95" value={pair(s.answers.retrievalMs)} />
              <Stat
                label="errors"
                value={pct(s.answers.errorRate)}
                tone={(s.answers.errorRate ?? 0) > 0.05 ? 'error' : undefined}
              />
            </Stats>
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {(
                [
                  ['not helpful', s.answers.thumbsDownRate, 'of rated answers'],
                  ['bad citations', s.answers.invalidCitationRate, 'of answers'],
                  ['weak retrieval', s.answers.weakRetrievalRate, 'of answers'],
                ] as const
              ).map(([label, v, of]) => (
                <div key={label} className="flex gap-1.5">
                  <dt className="text-ink-3">{label}</dt>
                  <dd className="m-0 text-ink-2">
                    {pct(v)} <span className="text-ink-3">{of}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-label="Usage per day" className="grid min-w-0 gap-10 lg:grid-cols-2">
            <LineChart
              title={t.calls}
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
              title={t.cost}
              x={x}
              formatX={day}
              values={days.map((d) => d.costUsd)}
              label="cost"
              formatY={(v) => usd(v)}
            />
            <div className="lg:col-span-2">
              <LineChart
                title={t.tokens}
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
              <SectionHeading id="providers" hint={t.providersHint}>
                {t.providers}
              </SectionHeading>
              <p className="mb-3 text-xs text-ink-3">
                {pct(s.providers.fallbackRate)} fell back to another model,{' '}
                {pct(s.providers.errorRate)} failed.
              </p>
              <DataTable label={t.providers} className="min-w-[420px]">
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
                        No provider calls in this range.
                      </TD>
                    </TR>
                  ) : (
                    s.providers.byProvider.map((p) => (
                      <TR key={p.provider}>
                        <TD>{p.provider}</TD>
                        <TD numeric>{count(p.calls)}</TD>
                        <TD numeric>{pct(p.errorRate)}</TD>
                        <TD numeric>{pct(p.fallbackRate)}</TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </DataTable>
            </div>

            <div>
              <SectionHeading>Ingestion</SectionHeading>
              <Stats>
                <Stat label="ready" value={String(s.ingestion.ready)} />
                <Stat
                  label="failed"
                  value={String(s.ingestion.failed)}
                  tone={s.ingestion.failed > 0 ? 'error' : undefined}
                />
                <Stat label="in progress" value={String(s.ingestion.inProgress)} />
                <Stat label="success" value={pct(s.ingestion.successRate)} />
                <Stat
                  label="average time"
                  value={s.ingestion.avgSeconds === null ? '—' : ms(s.ingestion.avgSeconds * 1000)}
                />
              </Stats>
            </div>
          </section>
        </div>
      )}

      <Health window={win} />
      <FailedQueries />
    </div>
  );
}
