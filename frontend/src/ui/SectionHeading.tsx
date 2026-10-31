import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type SectionHeadingProps = {
  children: ReactNode;
  /** A line of 13px help under the heading. */
  hint?: ReactNode;
  actions?: ReactNode;
  /** The heading level; pick the one that fits the page outline. */
  as?: 'h2' | 'h3';
  id?: string;
  className?: string;
};

export function SectionHeading({
  children,
  hint,
  actions,
  as: Tag = 'h2',
  id,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('mb-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <Tag id={id} className="heading-section min-w-0 text-ink">
          {children}
        </Tag>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
