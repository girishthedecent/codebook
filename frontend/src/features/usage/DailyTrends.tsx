import type { Usage, UsageDay } from '@/api/types';
import { Sparkline } from '@/features/admin/charts/Sparkline';
import { formatCost, formatCount } from '@/features/account/format';

type Row = {
  key: string;
  label: string;
  value: (day: UsageDay) => number;
  format: (n: number) => string;
};

const ROWS: Row[] = [
  { key: 'answers', label: 'Answers', value: (d) => d.answers, format: formatCount },
  { key: 'tokens', label: 'Tokens', value: (d) => d.tokens, format: formatCount },
  {
    key: 'cost',
    label: 'Cost',
    value: (d) => Number(d.costUsd),
    format: (n) => formatCost(String(n)),
  },
];

/** A sparkline per measure over the days the API returns, with the numbers in words beside it. */
export function DailyTrends({ daily }: { daily: Usage['daily'] }) {
  if (daily.length < 2) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-3 text-sm text-ink-2">{`Last ${daily.length} days`}</h3>
      <ul className="flex flex-col gap-3">
        {ROWS.map((row) => {
          const values = daily.map(row.value);
          const total = values.reduce((sum, v) => sum + v, 0);
          const today = values[values.length - 1]!;
          const summary = `${row.format(total)} in total, ${row.format(today)} today`;
          return (
            <li key={row.key} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-ink">{row.label}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-ink-2">{summary}</span>
                <Sparkline
                  values={values}
                  label={`${row.label} per day over the last ${daily.length} days: ${summary}`}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
