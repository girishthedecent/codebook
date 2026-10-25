/** Rounds a span to 1, 2 or 5 × 10ⁿ so tick labels read as clean numbers. */
function niceStep(span: number, count: number) {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** Ticks from 0 (or below, for negatives) up past the max, about `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = max > lo ? max : lo + 1;
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v < hi + step * 0.5; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export function linear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** 0 / 950 / 1.2K / 34K / 1.2M — compact from 1,000 up. */
export function compact(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${trim(v / 1e6)}M`;
  if (abs >= 1e3) return `${trim(v / 1e3)}K`;
  return trim(v);
}

function trim(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 1 ? 2 : 1).replace(/\.?0+$/, '');
}
