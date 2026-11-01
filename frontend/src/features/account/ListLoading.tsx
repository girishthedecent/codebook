import { Skeleton, VisuallyHidden } from '@/ui';
import { cn } from '@/lib/cn';

/** Grey rows where a list will be, for a page that already shows its own header. */
export function ListLoading({
  label,
  rows = 3,
  className,
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div role="status" className={cn('flex flex-col gap-3', className)}>
      <VisuallyHidden>{label}</VisuallyHidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
