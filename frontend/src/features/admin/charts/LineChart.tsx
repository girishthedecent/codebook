import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChartFrame, type Series } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import { compact, linear, niceTicks } from './scale';
import { useWidth } from './useWidth';

export type LineChartProps = {
  title: string;
  subtitle?: string;
  /** One label per x position (days, run names); `xLabel` formats it for the axis. */
  x: string[];
  series: Series[];
  formatY?: (v: number) => string;
  formatX?: (x: string) => string;
  /** A 10% wash under the line; only for a single series. */
  area?: boolean;
  height?: number;
};

const M = { top: 8, right: 12, bottom: 22 };

/**
 * Lines over time. A vertical crosshair snaps to the nearest x and one tooltip lists every
 * series there; arrow keys move it when the chart has focus. No animation.
 */
export function LineChart({
  title,
  subtitle,
  x,
  series,
  formatY = compact,
  formatX = (v) => v,
  area = false,
  height = 180,
}: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const left = 8 + Math.max(...ticks.map((t) => formatY(t).length)) * 7;
  const innerW = Math.max(40, width - left - M.right);
  const innerH = height - M.top - M.bottom;
  const sx = linear([0, Math.max(1, x.length - 1)], [left, left + innerW]);
  const sy = linear([ticks[0]!, ticks.at(-1)!], [M.top + innerH, M.top]);

  // Show about one x label per 80px, always including the last.
  const every = Math.max(1, Math.ceil(x.length / Math.max(1, Math.floor(innerW / 80))));
  const xTicks = x.map((_, i) => i).filter((i) => i % every === 0 || i === x.length - 1);

  const path = (values: (number | null)[]) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + left;
    const i = Math.round(((px - left) / innerW) * (x.length - 1));
    setActive(Math.min(x.length - 1, Math.max(0, i)));
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End')
      return;
    e.preventDefault();
    setActive((cur) => {
      const at = cur ?? (e.key === 'ArrowLeft' ? x.length : -1);
      if (e.key === 'Home') return 0;
      if (e.key === 'End') return x.length - 1;
      return Math.min(x.length - 1, Math.max(0, at + (e.key === 'ArrowLeft' ? -1 : 1)));
    });
  };

  const last = series.length === 1 ? lastValue(series[0]!.values) : null;
  const summary =
    `${title}: ${series.map((s) => s.label).join(', ')} over ${x.length} points` +
    (x.length ? `, ${formatX(x[0]!)} to ${formatX(x.at(-1)!)}` : '') +
    '. Use the arrow keys to read values.';

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      series={series}
      table={{
        columns: ['', ...series.map((s) => s.label)],
        rows: x.map((label, i) => [
          formatX(label),
          ...series.map((s) => (s.values[i] === null ? '—' : formatY(s.values[i]!))),
        ]),
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
            {xTicks.map((i) => (
              <text
                key={i}
                x={sx(i)}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === x.length - 1 ? 'end' : 'middle'}
                className="fill-ink-3 font-mono text-[11px]"
              >
                {formatX(x[i]!)}
              </text>
            ))}
            {area && series.length === 1 && (
              <path
                d={`${path(series[0]!.values)}L${sx(x.length - 1)},${sy(ticks[0]!)}L${sx(0)},${sy(ticks[0]!)}Z`}
                fill={series[0]!.color}
                opacity={0.1}
              />
            )}
            {series.map((s) => (
              <path
                key={s.key}
                d={path(s.values)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {last && (
              <>
                <circle
                  cx={sx(last.i)}
                  cy={sy(last.v)}
                  r={4}
                  fill={series[0]!.color}
                  stroke="var(--paper)"
                  strokeWidth={2}
                />
                <text
                  x={sx(last.i)}
                  y={sy(last.v) - 10}
                  textAnchor="end"
                  className="fill-ink-2 font-mono text-[11px]"
                >
                  {formatY(last.v)}
                </text>
              </>
            )}
            {active !== null && (
              <g aria-hidden>
                <line
                  x1={sx(active)}
                  x2={sx(active)}
                  y1={M.top}
                  y2={M.top + innerH}
                  stroke="var(--ink-3)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {series.map((s) =>
                  s.values[active] === null || s.values[active] === undefined ? null : (
                    <circle
                      key={s.key}
                      cx={sx(active)}
                      cy={sy(s.values[active]!)}
                      r={4}
                      fill={s.color}
                      stroke="var(--paper)"
                      strokeWidth={2}
                    />
                  ),
                )}
              </g>
            )}
            <rect
              x={left}
              y={M.top}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}
        {active !== null && (
          <ChartTooltip
            x={sx(active)}
            y={M.top}
            width={width}
            title={formatX(x[active]!)}
            rows={series.map((s) => ({
              key: s.key,
              color: s.color,
              label: s.label,
              value: s.values[active] === null ? '—' : formatY(s.values[active]!),
            }))}
          />
        )}
      </div>
    </ChartFrame>
  );
}

function lastValue(values: (number | null)[]) {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined) return { i, v };
  }
  return null;
}
