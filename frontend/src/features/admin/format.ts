// Number formats for the admin pages. Metrics are 0–1 and read best as three decimals.

export const dash = '—';

export function metric(v: unknown) {
  return typeof v === 'number' ? v.toFixed(3) : dash;
}

export function pct(v: number | null | undefined) {
  return typeof v === 'number' ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%` : dash;
}

export function ms(v: unknown) {
  if (typeof v !== 'number') return dash;
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
}

export function usd(v: string | number | null | undefined) {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || Number.isNaN(n)) return dash;
  if (n === 0) return '$0';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/** Signed delta with three decimals: +0.012, −0.004, 0.000. */
export function delta(v: number | null | undefined) {
  if (typeof v !== 'number') return dash;
  if (Math.abs(v) < 0.0005) return '0.000';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function shortDate(iso: string) {
  return dateFmt.format(new Date(iso));
}

export function dateTime(iso: string) {
  return timeFmt.format(new Date(iso));
}

/** "2026-10-25" → "Oct 25", read as a UTC day so it doesn't shift by timezone. */
export function day(isoDay: string) {
  return dateFmt.format(new Date(`${isoDay}T12:00:00Z`));
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relative(iso: string) {
  const sec = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(Math.round(sec), 'second');
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day');
  return shortDate(iso);
}
