const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

// Each unit and how many of it make the next one.
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Infinity],
];

/** "just now", "5 min. ago", "yesterday", "3 wk. ago". */
export function relativeDate(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (Math.abs(seconds) < 45) return 'just now';
  let value = seconds / 60;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), 'year');
}
