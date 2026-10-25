import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Figure = { label: string; value: string; note?: ReactNode; tone?: 'error' };

/**
 * A row of headline numbers separated by hairlines — not cards. Large mono figures with a
 * small label under each; wraps to two columns on phones.
 */
export function Figures({ items, className }: { items: Figure[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 border-y border-rule sm:flex sm:flex-wrap sm:divide-x sm:divide-rule',
        className,
      )}
    >
      {items.map((f) => (
        <div
          key={f.label}
          className="flex flex-col-reverse gap-0.5 border-b border-rule px-4 py-3 last:border-b-0 sm:border-b-0 sm:first:pl-0"
        >
          <dt className="text-xs text-ink-3">
            {f.label}
            {f.note && <span className="ml-1">{f.note}</span>}
          </dt>
          <dd
            className={cn(
              'm-0 font-mono text-xl leading-none font-medium tabular-nums',
              f.tone === 'error' ? 'text-error' : 'text-ink',
            )}
          >
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
