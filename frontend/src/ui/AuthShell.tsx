import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/cn';
import { Wordmark } from './Wordmark';

export type AuthShellProps = {
  children: ReactNode;
  /** An editorial panel beside the form on wide screens, hidden below the lg breakpoint. */
  aside?: ReactNode;
};

/** The page around sign-in, the demo entry and the first workspace: one centred column. */
export function AuthShell({ children, aside }: AuthShellProps) {
  const split = Boolean(aside);
  return (
    <div
      className={cn(
        'min-h-dvh bg-paper text-ink',
        split && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(26rem,34rem)]',
      )}
    >
      {split && (
        <aside className="hidden border-r border-rule bg-paper-2 px-14 py-10 lg:flex lg:flex-col">
          <Link to="/" className="self-start rounded-xs">
            <Wordmark size="lg" />
          </Link>
          <div className="mt-auto max-w-prose pb-6">{aside}</div>
        </aside>
      )}
      <main
        id="main"
        className="flex min-h-dvh flex-col px-4 pt-8 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-8"
      >
        <Link to="/" className={cn('self-start rounded-xs', split && 'lg:hidden')}>
          <Wordmark />
        </Link>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
