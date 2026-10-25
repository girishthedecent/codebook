import { linear } from './scale';
import './chart.css';

/**
 * A small trend line with no axes: the history in the de-emphasis ink, the latest point as
 * an accent dot with a paper ring. Read as a picture; the numbers live next to it.
 */
export function Sparkline({
  values,
  label,
  width = 96,
  height = 24,
}: {
  values: number[];
  /** Spoken summary, e.g. "recall@5 over the last 8 runs, latest 0.82". */
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = 4;
  const sx = linear([0, values.length - 1], [pad, width - pad]);
  const sy = linear(hi === lo ? [lo - 1, hi + 1] : [lo, hi], [height - pad, pad]);
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)
    .join('');
  const last = values.length - 1;
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="inline-block align-middle"
    >
      <title>{label}</title>
      <path
        d={d}
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={sx(last)}
        cy={sy(values[last]!)}
        r={3}
        fill="var(--series-1)"
        stroke="var(--paper)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
