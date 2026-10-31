import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type EmptyStateProps = {
  /** One sentence saying what is missing and, if it helps, why. */
  children: ReactNode;
  /** A Button or TextLink that fixes it. */
  action?: ReactNode;
  className?: string;
};

/** Nothing here yet: a short rule, a sentence, and the way forward if there is one. */
export function EmptyState({ children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('max-w-prose py-8', className)}>
      <span aria-hidden className="mb-4 block h-px w-8 bg-edge" />
      <p className="font-serif text-base text-pretty text-ink-2">{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
