import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { evalResultsQueryOptions, useEvalCompare } from '@/api/queries';
import type { EvalComparison, EvalResult } from '@/api/types';
import { ProgressRule, Table, TBody, TD, TH, THead, TR } from '@/ui';
import { RouteError } from '@/ui/RouteError';
import { cn } from '@/lib/cn';
import { delta, metric } from '../format';
import { ScrollTable } from '../ScrollTable';
import { strings } from '../strings';
import { CaseDetail } from './CaseDetail';
import { metricsFor, typeLabel, type MetricDef } from './metrics';

// Changes smaller than this are noise between two runs of the same config.
const NOISE = 0.01;

const changeLabel: Record<string, string> = {
  broke: 'broke',
  worse: 'worse',
  'only-a': 'only in A',
  'only-b': 'only in B',
  better: 'better',
  fixed: 'fixed',
};

type CaseRow = {
  caseId: string;
  externalId: string;
  type: string;
  question: string;
  a: { score: number | null; error: string | null } | null;
  b: { score: number | null; error: string | null } | null;
  change: string;
};

/** Two runs side by side: metric deltas (B − A), cases that changed, and their answers. */
export function ComparePage({ a, b }: { a: string; b: string }) {
  const compare = useEvalCompare([a, b]);
  const [selected, setSelected] = useState<string | null>(null);

  if (compare.error)
    return <RouteError error={compare.error} reset={() => void compare.refetch()} />;
  if (!compare.data) return <ProgressRule label="Comparing runs" />;

  const c = compare.data;
  const defs = metricsFor(c.suite);
  const cases = c.cases as unknown as CaseRow[];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link to="/admin/evals" className="text-xs text-ink-3 hover:text-ink">
          ← {strings.evals.runs}
        </Link>
        <h2 className="mt-2 text-lg font-medium text-ink">Compare {c.suite} runs</h2>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {(['a', 'b'] as const).map((side) => (
            <div key={side} className="flex gap-2">
              <dt className="w-4 font-mono text-ink-3">{side.toUpperCase()}</dt>
              <dd className="m-0">
                <Link
                  to="/admin/evals/$runId"
                  params={{ runId: c.runs[side].id }}
                  className="font-mono text-ink hover:text-accent hover:underline"
                >
                  {c.runs[side].name}
                </Link>
                <span className="ml-2 font-mono text-xs text-ink-3">
                  {c.runs[side].gitSha?.slice(0, 7)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <section aria-labelledby="deltas">
        <h3 id="deltas" className="mb-2 text-sm font-medium text-ink">
          Metrics
        </h3>
        <DeltaTable overall={c.overall} defs={defs} />
      </section>

      {Object.keys(c.byType).length > 0 && (
        <section aria-labelledby="by-type">
          <h3 id="by-type" className="mb-2 text-sm font-medium text-ink">
            By case type
          </h3>
          <ByType byType={c.byType} defs={defs} />
        </section>
      )}

      <section aria-labelledby="changed" className="min-w-0">
        <h3 id="changed" className="mb-1 text-sm font-medium text-ink">
          Cases that changed
        </h3>
        <p className="mb-3 font-mono text-xs text-ink-3">
          {Object.entries(c.counts)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${changeLabel[k] ?? k} ${n}`)
            .join(' · ')}
        </p>
        {cases.length === 0 ? (
          <p className="text-sm text-ink-3">{strings.evals.noChanges}</p>
        ) : (
          <ScrollTable>
            <Table>
              <THead>
                <TR>
                  <TH>Case</TH>
                  <TH>Type</TH>
                  <TH>Question</TH>
                  <TH className="text-right">A</TH>
                  <TH className="text-right">B</TH>
                  <TH>Change</TH>
                </TR>
              </THead>
              <TBody>
                {cases.map((row) => (
                  <TR
                    key={row.caseId}
                    className={cn(
                      'cursor-pointer hover:bg-paper-2',
                      selected === row.caseId && 'bg-accent-wash',
                    )}
                    onClick={() => setSelected(selected === row.caseId ? null : row.caseId)}
                  >
                    <TD>
                      <button
                        type="button"
                        className="font-mono text-xs text-ink hover:underline"
                        aria-expanded={selected === row.caseId}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(selected === row.caseId ? null : row.caseId);
                        }}
                      >
                        {row.externalId}
                      </button>
                    </TD>
                    <TD className="font-mono text-xs text-ink-3">{typeLabel(row.type)}</TD>
                    <TD className="max-w-[28rem] truncate text-ink-2">{row.question}</TD>
                    <TD numeric>{side(row.a)}</TD>
                    <TD numeric>{side(row.b)}</TD>
                    <TD
                      className={cn(
                        'text-xs',
                        row.change === 'broke' || row.change === 'worse'
                          ? 'text-error'
                          : row.change === 'better' || row.change === 'fixed'
                            ? 'text-ok'
                            : 'text-ink-3',
                      )}
                    >
                      {changeLabel[row.change] ?? row.change}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </ScrollTable>
        )}
      </section>

      {selected && <SideBySide caseId={selected} a={a} b={b} />}
    </div>
  );
}

function side(s: CaseRow['a']) {
  if (!s) return '—';
  if (s.error) return 'error';
  return s.score === null ? '—' : s.score.toFixed(2);
}

function DeltaCell({ d, def }: { d: { delta: number | null }; def?: MetricDef }) {
  const v = d.delta;
  const real = typeof v === 'number' && Math.abs(v) >= NOISE;
  const good = real && (def?.higherIsBetter ?? true) === v > 0;
  return (
    <TD numeric className={cn(real ? (good ? 'text-ok' : 'text-error') : 'text-ink-3')}>
      {real && <span aria-hidden>{v! > 0 ? '↑ ' : '↓ '}</span>}
      {delta(v)}
      {real && <span className="sr-only">{good ? ' (better)' : ' (worse)'}</span>}
    </TD>
  );
}

function DeltaTable({ overall, defs }: { overall: EvalComparison['overall']; defs: MetricDef[] }) {
  const keys = orderedKeys(Object.keys(overall), defs);
  return (
    <ScrollTable className="[&_table]:min-w-[420px]">
      <Table className="max-w-[640px]">
        <THead>
          <TR>
            <TH>Metric</TH>
            <TH className="text-right">A</TH>
            <TH className="text-right">B</TH>
            <TH className="text-right">Δ</TH>
          </TR>
        </THead>
        <TBody>
          {keys.map((k) => {
            const def = defs.find((d) => d.key === k);
            const fmt = def?.format ?? metric;
            return (
              <TR key={k}>
                <TD className="text-ink-2">{def?.label ?? k}</TD>
                <TD numeric>{fmt(overall[k]!.a)}</TD>
                <TD numeric>{fmt(overall[k]!.b)}</TD>
                <DeltaCell d={overall[k]!} def={def} />
              </TR>
            );
          })}
        </TBody>
      </Table>
    </ScrollTable>
  );
}

function ByType({ byType, defs }: { byType: EvalComparison['byType']; defs: MetricDef[] }) {
  // One column per type for the suite's first two metrics keeps this readable.
  const shown = defs.slice(0, 2);
  const types = Object.keys(byType).sort();
  return (
    <ScrollTable>
      <Table>
        <THead>
          <TR>
            <TH>Type</TH>
            {shown.map((d) => (
              <TH key={d.key} className="text-right" colSpan={3}>
                {d.label} (A · B · Δ)
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {types.map((t) => (
            <TR key={t}>
              <TD className="font-mono text-xs text-ink-2">{typeLabel(t)}</TD>
              {shown.map((d) => {
                const cell = byType[t]?.[d.key] ?? { a: null, b: null, delta: null };
                return [
                  <TD key={`${d.key}a`} numeric>
                    {d.format(cell.a)}
                  </TD>,
                  <TD key={`${d.key}b`} numeric>
                    {d.format(cell.b)}
                  </TD>,
                  <DeltaCell key={`${d.key}d`} d={cell} def={d} />,
                ];
              })}
            </TR>
          ))}
        </TBody>
      </Table>
    </ScrollTable>
  );
}

function orderedKeys(keys: string[], defs: MetricDef[]) {
  const known = defs.map((d) => d.key).filter((k) => keys.includes(k));
  return [...known, ...keys.filter((k) => !known.includes(k)).sort()];
}

/** Both runs' records for one case; results load only once a case is picked. */
function SideBySide({ caseId, a, b }: { caseId: string; a: string; b: string }) {
  const left = useQuery(evalResultsQueryOptions(a));
  const right = useQuery(evalResultsQueryOptions(b));
  const find = (rows: EvalResult[] | undefined) => rows?.find((r) => r.caseId === caseId);
  return (
    <section aria-label="Selected case in both runs" className="border-t border-rule pt-6">
      <div className="grid gap-8 lg:grid-cols-2">
        {(
          [
            ['A', left],
            ['B', right],
          ] as const
        ).map(([name, q]) => {
          const result = find(q.data);
          return (
            <div key={name} className="min-w-0">
              <h4 className="font-mono text-sm text-ink-3">Run {name}</h4>
              {q.isPending ? (
                <ProgressRule label={`Loading run ${name}`} className="mt-3" />
              ) : result ? (
                <div className="[&>div]:lg:grid-cols-1">
                  <CaseDetail result={result} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-3">This case isn't in run {name}.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
