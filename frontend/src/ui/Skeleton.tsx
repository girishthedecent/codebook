import { cn } from '@/lib/cn';
import { VisuallyHidden } from './VisuallyHidden';

/** A grey block that holds the place of content. Size it with the classes of what it replaces. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('rounded-xs bg-paper-3 animate-pulse motion-reduce:animate-none', className)}
    />
  );
}

/**
 * A page-shaped placeholder: a title, an intro line and rows. Matches PageHeader and a list
 * closely enough that the content doesn't jump when it arrives.
 */
export function PageLoading({
  label = 'Loading',
  rows = 4,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div role="status" className={cn('flex flex-col gap-8', className)}>
      <VisuallyHidden>{label}</VisuallyHidden>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-2/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
