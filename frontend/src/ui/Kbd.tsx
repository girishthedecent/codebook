import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A keyboard key or chord, e.g. <Kbd>⌘K</Kbd>. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-rule-2 px-1 font-mono text-[11px] text-ink-3',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
