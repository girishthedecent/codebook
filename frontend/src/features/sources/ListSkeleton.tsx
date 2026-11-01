import { Skeleton, VisuallyHidden } from '@/ui';

/** Rows of grey where a list will be, so the page doesn't jump when it arrives. */
export function ListSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3 py-2">
      <VisuallyHidden>{label}</VisuallyHidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5" />
      ))}
    </div>
  );
}
