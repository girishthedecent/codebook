import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A row of `Stat`s. Renders a description list, which is what each Stat is a pair of. */
export function Stats({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('flex flex-wrap gap-x-10 gap-y-5', className)}>{children}</dl>;
}

export type StatProps = {
  label: string;
  value: ReactNode;
  /** Small text after the label, e.g. a unit or a range. */
  note?: ReactNode;
  tone?: 'error';
  className?: string;
};

/** A figure with its name under it. Set in the serif's lining, tabular figures. */
export function Stat({ label, value, note, tone, className }: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col-reverse gap-1', className)}>
      <dt className="text-xs text-ink-3">
        {label}
        {note && <span className="ml-1">{note}</span>}
      </dt>
      <dd
        className={cn(
          'm-0 font-serif text-xl leading-none font-medium tabular-nums lining-nums',
          tone === 'error' ? 'text-error' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
