import { cn } from '@/lib/cn';

/** A thin ring. Default size 16px; pass `size-*` to change it. */
export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block size-4 shrink-0 animate-spin rounded-full border border-rule-2 border-t-ink-2',
        className,
      )}
    />
  );
}
