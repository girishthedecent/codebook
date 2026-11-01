const numbers = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const day = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' });
const dayYear = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
const clock = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

export function formatCount(n: number) {
  return n >= 100_000 ? compact.format(n) : numbers.format(n);
}

/** The backend sends cost as a decimal string; small amounts keep four places so they aren't $0.00. */
export function formatCost(usd: string) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n === 0) return '$0';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "today", "yesterday", "3 days ago", then a plain date. */
export function formatWhen(iso: string, now = new Date()) {
  const then = new Date(iso);
  const days = Math.floor((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return then.getFullYear() === now.getFullYear() ? day.format(then) : dayYear.format(then);
}

/** A moment just ahead as "in about 5 hours, at 9:30 PM", for when a limit starts over. */
export function formatReset(iso: string, now = new Date()) {
  const then = new Date(iso);
  const minutes = Math.round((then.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return 'now';
  const at = clock.format(then);
  if (minutes < 60) return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, at ${at}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} ${hours === 1 ? 'hour' : 'hours'}, at ${at}`;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
