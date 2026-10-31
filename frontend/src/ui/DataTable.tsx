import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Table } from './Table';

const pinned =
  '[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-[1] [&_td:first-child]:bg-paper ' +
  '[&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[2] [&_th:first-child]:bg-paper ' +
  '[&_tr:hover_td:first-child]:bg-paper-2';

export type DataTableProps = {
  /** Names the scrolling region for screen readers, e.g. "Evaluation runs". */
  label: string;
  /** Keep the first column in view while the rest scrolls sideways. */
  pinFirstColumn?: boolean;
  /** Classes for the table itself, e.g. a minimum width. */
  className?: string;
  children: ReactNode;
};

/**
 * A table that scrolls sideways on its own instead of widening the page. On phones it runs to
 * the screen edges (it assumes a 16px page gutter). Compose the rows with THead, TBody, TR.
 */
export function DataTable({ label, pinFirstColumn, className, children }: DataTableProps) {
  return (
    <div
      role="region"
      aria-label={label}
      // Focusable so a keyboard can scroll it.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', pinFirstColumn && pinned)}
    >
      <Table bare className={className}>
        {children}
      </Table>
    </div>
  );
}
