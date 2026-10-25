import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A wide table that scrolls sideways on small screens with its first column pinned. Wraps a
 * <Table>; the pinned cells take the paper background so text doesn't show through.
 */
export function ScrollTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        '-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0',
        '[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-[1] [&_td:first-child]:bg-paper',
        '[&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[2] [&_th:first-child]:bg-paper',
        '[&_table]:min-w-[720px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
