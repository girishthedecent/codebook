import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'error';

// Shape differs as well as colour, so a dot on its own isn't colour-only.
const marks: Record<Tone, string> = {
  neutral: 'rounded-full border border-ink-3',
  accent: 'rounded-full bg-accent',
  ok: 'rounded-full bg-ok',
  warn: 'rounded-full bg-warn',
  error: 'rotate-45 rounded-[1px] bg-error',
};

export type StatusDotProps = {
  tone?: Tone;
  /** The state in words: shown beside the dot, or read out when the dot stands alone. */
  label: string;
  hideLabel?: boolean;
  className?: string;
};

export function StatusDot({ tone = 'neutral', label, hideLabel, className }: StatusDotProps) {
  const mark = <span className={cn('inline-block size-2 shrink-0', marks[tone])} />;
  if (hideLabel) {
    return (
      <span role="img" aria-label={label} className={cn('inline-flex', className)}>
        {mark}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-ink-2', className)}>
      <span aria-hidden className="inline-flex">
        {mark}
      </span>
      {label}
    </span>
  );
}
