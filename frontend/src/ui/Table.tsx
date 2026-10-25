import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Plain semantic tables with hairline rows. Compose: <Table><THead><TR><TH/></TR></THead><TBody>…
 * `stickyHeader` keeps the head visible inside a scrolling parent; `bare` skips the built-in
 * horizontal scroller when the parent provides one.
 */
export function Table({
  className,
  stickyHeader,
  bare,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { stickyHeader?: boolean; bare?: boolean }) {
  const table = (
    <table
      className={cn(
        'w-full border-collapse text-left text-sm',
        stickyHeader &&
          '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-paper',
        className,
      )}
      {...rest}
    />
  );
  // `bare` leaves scrolling to a parent that already has a scroller.
  return bare ? table : <div className="w-full overflow-x-auto">{table}</div>;
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-rule last:border-b-0', className)} {...rest} />;
}

export function TH({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-rule-2 px-3 py-2 text-xs font-medium text-ink-3',
        className,
      )}
      {...rest}
    />
  );
}

export function TD({
  className,
  numeric,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-top text-ink',
        numeric && 'text-right font-mono text-xs tabular-nums',
        className,
      )}
      {...rest}
    />
  );
}
