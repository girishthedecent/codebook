import type { ReactNode } from 'react';

export type TooltipRow = { key: string; color: string; label: string; value: string };

/**
 * The readout that follows the crosshair or the hovered bar. Values lead, series names follow,
 * each keyed with a short stroke of its color. Positioned by the chart in px within its frame.
 */
export function ChartTooltip({
  x,
  y,
  width,
  title,
  rows,
}: {
  x: number;
  y: number;
  width: number;
  title: ReactNode;
  rows: TooltipRow[];
}) {
  // Flip to the left of the pointer when it would run past the right edge.
  const flip = x > width - 180;
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 min-w-[140px] rounded-sm border border-rule bg-paper px-2.5 py-2 text-xs shadow-float"
      style={{
        left: flip ? undefined : x + 12,
        right: flip ? width - x + 12 : undefined,
        top: Math.max(0, y - 8),
      }}
    >
      <div className="mb-1 font-mono text-ink-3">{title}</div>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2 py-px">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: row.color }} />
          <span className="font-mono font-medium text-ink tabular-nums">{row.value}</span>
          <span className="text-ink-3">{row.label}</span>
        </div>
      ))}
    </div>
  );
}
