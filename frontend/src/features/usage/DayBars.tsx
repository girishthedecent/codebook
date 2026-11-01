import { useState, type KeyboardEvent } from 'react';
import type { UsageDay } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatCost, formatCount } from '@/features/account/format';
import { strings } from '@/features/account/strings';

const s = strings.usage.days;
const HEIGHT = 64;

// Days are UTC dates, so they are formatted in UTC too or they would slip a day west of Greenwich.
const dayName = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const shortDay = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const tokensOf = (d: UsageDay) => d.tokensIn + d.tokensOut;
const reading = (d: UsageDay, label = dayName.format(asDate(d.date))) =>
  s.reading(label, d.questions, formatCount(tokensOf(d)), formatCost(String(d.costUsd)));

/**
 * Questions per day as a row of small columns, today in the accent. Pointer or arrow keys pick
 * a day and the line under the columns reads it out; the same numbers are in a table behind
 * "Show as table" for anyone who would rather not hunt for them.
 */
export function DayBars({ days }: { days: UsageDay[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (days.length === 0) return null;

  const last = days.length - 1;
  const top = Math.max(1, ...days.map((d) => d.questions));
  const total = days.reduce((sum, d) => sum + d.questions, 0);
  const shown = active ?? last;
  const readout = shown === last ? reading(days[last]!, s.today) : reading(days[shown]!);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, (at: number) => number> = {
      ArrowLeft: (at) => Math.max(0, at - 1),
      ArrowRight: (at) => Math.min(last, at + 1),
      Home: () => 0,
      End: () => last,
    };
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    setActive((at) => move(at ?? last));
  };

  return (
    <figure className="m-0">
      {/* A slider over the days: arrow keys move it and the reading is its spoken value. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={s.label(days.length, formatCount(total))}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={shown}
        aria-valuetext={readout}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        // A tap ends with the pointer leaving, which would clear the day it just picked.
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActive(null);
        }}
        className="flex items-end gap-1 rounded-xs outline-offset-4 sm:gap-1.5"
        style={{ height: HEIGHT }}
      >
        {days.map((day, i) => {
          const share = day.questions / top;
          return (
            <div
              key={day.date}
              aria-hidden
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <div
                className={cn(
                  'w-full rounded-t-[3px] transition-opacity duration-150',
                  day.questions === 0 ? 'bg-rule-2' : i === last ? 'bg-series-1' : 'bg-series-2',
                  active !== null && active !== i && 'opacity-45',
                )}
                // An empty day still gets a hairline, so the fourteen days read as a row.
                style={{ height: day.questions === 0 ? 1 : Math.max(3, share * HEIGHT) }}
              />
            </div>
          );
        })}
      </div>
      <div aria-hidden className="mt-1.5 flex justify-between text-xs text-ink-3">
        <span>{shortDay.format(asDate(days[0]!.date))}</span>
        <span>{s.today}</span>
      </div>
      <figcaption aria-hidden className="mt-2 text-sm text-ink-2 tabular-nums">
        {readout}
      </figcaption>
      <details className="mt-3 text-xs text-ink-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center select-none hover:text-ink-2 sm:min-h-0">
          {s.table}
        </summary>
        <table className="mt-2 w-full border-collapse tabular-nums">
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="py-1 pr-2 text-left font-medium">
                {s.cols.day}
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                {s.cols.questions}
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                {s.cols.tokens}
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-medium">
                {s.cols.cost}
              </th>
            </tr>
          </thead>
          <tbody className="font-mono text-ink-2">
            {days.map((day) => (
              <tr key={day.date} className="border-b border-rule last:border-b-0">
                <th scope="row" className="py-1 pr-2 text-left font-sans font-normal">
                  {dayName.format(asDate(day.date))}
                </th>
                <td className="px-2 py-1 text-right">{formatCount(day.questions)}</td>
                <td className="px-2 py-1 text-right">{formatCount(tokensOf(day))}</td>
                <td className="py-1 pl-2 text-right">{formatCost(String(day.costUsd))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
