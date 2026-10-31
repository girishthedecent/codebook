import type { SourceType } from '@/api/types';
import { cn } from '@/lib/cn';
import { sourceKind, type SourceKind } from '@/lib/sourceKind';

const tones: Record<SourceKind, string> = {
  book: 'bg-kind-book-wash text-kind-book',
  repo: 'bg-kind-repo-wash text-kind-repo',
  site: 'bg-kind-site-wash text-kind-site',
};

export type SourceBadgeProps = {
  type: SourceType;
  /** Write the kind (Book, Repository, Website) beside the glyph. */
  showLabel?: boolean;
  className?: string;
};

/** A small glyph in the kind's tone: a book, a repository or a website. */
export function SourceBadge({ type, showLabel, className }: SourceBadgeProps) {
  const { kind, label, Icon } = sourceKind(type);
  const glyph = (
    <span
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-sm',
        tones[kind],
      )}
    >
      <Icon size={14} aria-hidden />
    </span>
  );
  if (showLabel) {
    return (
      <span className={cn('inline-flex items-center gap-2 text-xs text-ink-2', className)}>
        {glyph}
        {label}
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className={cn('inline-flex', className)}>
      {glyph}
    </span>
  );
}
