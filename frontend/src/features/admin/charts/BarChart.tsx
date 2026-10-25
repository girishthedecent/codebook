import { useState, type KeyboardEvent } from 'react';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import { compact, linear, niceTicks } from './scale';
import { useWidth } from './useWidth';

export type BarChartProps = {
  title: string;
  subtitle?: string;
  /** Category per column (types, days). */
  x: string[];
  values: (number | null)[];
  /** Name of the measure, for the tooltip and table. */
  label: string;
  color?: string;
  formatY?: (v: number) => string;
  formatX?: (x: string) => string;
  /** Fixed top of the scale, e.g. 1 for rates so short bars don't look full. */
  max?: number;
  height?: number;
};

const M = { top: 18, right: 8, bottom: 22 };
const MAX_BAR = 24;

/**
 * Columns from one baseline: at most 24px wide, 4px rounded tops, square at the base, a gap
 * between neighbours. Each column is its own hover target; arrow keys step through them.
 * Values sit on the caps only when there are few columns.
 */
export function BarChart({
  title,
  subtitle,
  x,
  values,
  label,
  color = 'var(--series-1)',
  formatY = compact,
  formatX = (v) => v,
  max,
  height = 180,
}: BarChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const numbers = values.filter((v): v is number => v !== null);
  const ticks = niceTicks(0, Math.max(max ?? 0, ...numbers, 0));
  const left = 8 + Math.max(...ticks.map((t) => formatY(t).length)) * 7;
  const innerW = Math.max(40, width - left - M.right);
  const innerH = height - M.top - M.bottom;
  const band = innerW / Math.max(1, x.length);
  const barW = Math.max(2, Math.min(MAX_BAR, band - 2));
  const sy = linear([0, ticks.at(-1)!], [M.top + innerH, M.top]);
  const capLabels = x.length <= 12;
  const every = Math.max(1, Math.ceil(x.length / Math.max(1, Math.floor(innerW / 64))));

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setActive((cur) => {
      const at = cur ?? (e.key === 'ArrowLeft' ? x.length : -1);
      return Math.min(x.length - 1, Math.max(0, at + (e.key === 'ArrowLeft' ? -1 : 1)));
    });
  };

  const summary = `${title}: ${label} for ${x.length} ${x.length === 1 ? 'item' : 'items'}. Use the arrow keys to read values.`;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      series={[{ key: 'v', label, color, values }]}
      legendMark="rect"
      table={{
        columns: ['', label],
        rows: x.map((c, i) => [formatX(c), values[i] === null ? '—' : formatY(values[i]!)]),
      }}
    >
      <div ref={ref} className="relative w-full">
        {x.length === 0 ? (
          <p className="flex items-center text-sm text-ink-3" style={{ height }}>
            No data in this range.
          </p>
        ) : (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={summary}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="block overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <title>{summary}</title>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={left}
                  x2={left + innerW}
                  y1={sy(t)}
                  y2={sy(t)}
                  stroke="var(--rule)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={left - 8}
                  y={sy(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-ink-3 font-mono text-[11px]"
                >
                  {formatY(t)}
                </text>
              </g>
            ))}
            {x.map((c, i) => {
              const v = values[i];
              const cx = left + band * i + band / 2;
              const showX = i % every === 0 || i === x.length - 1;
              return (
                <g
                  key={c + i}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onPointerDown={() => setActive(i)}
                >
                  {/* Hit area: the whole band, taller than the bar. */}
                  <rect
                    x={left + band * i}
                    y={M.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                  />
                  {v !== null && v !== undefined && v > 0 && (
                    <path
                      d={columnPath(cx - barW / 2, sy(v), barW, sy(0) - sy(v))}
                      fill={color}
                      opacity={active === null || active === i ? 1 : 0.55}
                    />
                  )}
                  {capLabels && v !== null && v !== undefined && (
                    <text
                      x={cx}
                      y={sy(v) - 5}
                      textAnchor="middle"
                      className="fill-ink-2 font-mono text-[11px]"
                    >
                      {formatY(v)}
                    </text>
                  )}
                  {showX && (
                    <text
                      x={cx}
                      y={height - 6}
                      textAnchor="middle"
                      className="fill-ink-3 font-mono text-[11px]"
                    >
                      {formatX(c)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {active !== null && (
          <ChartTooltip
            x={left + band * active + band / 2}
            y={M.top}
            width={width}
            title={formatX(x[active]!)}
            rows={[
              {
                key: 'v',
                color,
                label,
                value: values[active] === null ? '—' : formatY(values[active]!),
              },
            ]}
          />
        )}
      </div>
    </ChartFrame>
  );
}

/** A column with a 4px rounded top and a square base. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return (
    `M${x},${y + h}` +
    `V${y + r}` +
    `Q${x},${y} ${x + r},${y}` +
    `H${x + w - r}` +
    `Q${x + w},${y} ${x + w},${y + r}` +
    `V${y + h}Z`
  );
}
