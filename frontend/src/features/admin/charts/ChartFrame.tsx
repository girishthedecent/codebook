import type { ReactNode } from 'react';
import './chart.css';

export type Series = {
  key: string;
  label: string;
  /** A CSS color, normally `var(--series-1)` / `var(--series-2)`. */
  color: string;
  values: (number | null)[];
};

/**
 * Title, legend and a table view around a chart. The legend shows only for two or more series
 * (one series is named by the title), and the table keeps every value reachable without hover.
 */
export function ChartFrame({
  title,
  subtitle,
  series,
  legendMark = 'line',
  table,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  series: Series[];
  legendMark?: 'line' | 'rect';
  table: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span>
          <span className="text-sm font-medium text-ink">{title}</span>
          {subtitle && <span className="ml-2 text-xs text-ink-3">{subtitle}</span>}
        </span>
        {series.length > 1 && (
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={
                    legendMark === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-xs'
                  }
                  style={{ background: s.color }}
                />
                {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      {children}
      <details className="mt-2 text-xs text-ink-3">
        <summary className="cursor-pointer select-none hover:text-ink-2">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full border-collapse font-mono tabular-nums">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={
                      'border-b border-rule px-2 py-1 font-sans font-medium ' +
                      (i === 0 ? 'text-left' : 'text-right')
                    }
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r} className="border-b border-rule last:border-b-0">
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={'px-2 py-1 text-ink-2 ' + (i === 0 ? 'text-left' : 'text-right')}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
