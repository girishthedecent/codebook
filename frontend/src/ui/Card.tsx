import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article' | 'li';
  /** No padding, for a card whose content runs to the edge (a table, a list). */
  bare?: boolean;
};

/** A separate object on the page, on a slightly darker paper. For anything else, use a rule. */
export function Card({ as: Tag = 'div', bare, className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn('rounded-md border border-rule bg-paper-2', !bare && 'p-4 sm:p-5', className)}
      {...rest}
    />
  );
}
