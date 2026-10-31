import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type PageHeaderProps = {
  title: ReactNode;
  /** A short label above the title, set in small caps. */
  kicker?: ReactNode;
  intro?: ReactNode;
  /** Buttons at the right of the title; they wrap below it on a narrow screen. */
  actions?: ReactNode;
  className?: string;
};

/** The top of a page: serif title, an optional kicker and intro, and actions. */
export function PageHeader({ title, kicker, intro, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-8', className)}>
      {kicker && <p className="small-caps mb-1.5 font-serif text-sm text-ink-3">{kicker}</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <h1 className="heading-page min-w-0 text-ink [overflow-wrap:anywhere]">{title}</h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {intro && (
        <p className="mt-3 max-w-prose font-serif text-base text-pretty text-ink-2">{intro}</p>
      )}
    </header>
  );
}
