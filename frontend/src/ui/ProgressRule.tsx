import { cn } from '@/lib/cn';

export type ProgressRuleProps = {
  /** 0–1. Leave undefined for the indeterminate sweep. */
  value?: number;
  label: string;
  className?: string;
};

/** The 1px progress line under a source row or at the top of a pane. No percentage badge. */
export function ProgressRule({ value, label, className }: ProgressRuleProps) {
  const determinate = typeof value === 'number';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(Math.min(1, Math.max(0, value)) * 100) : undefined}
      className={cn('relative h-px w-full overflow-hidden bg-rule', className)}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 bg-accent',
          !determinate && 'w-1/3 animate-[sweep_1.4s_ease-in-out_infinite]',
        )}
        style={
          determinate
            ? {
                width: `${Math.min(1, Math.max(0, value)) * 100}%`,
                transition: 'width 180ms ease-out',
              }
            : undefined
        }
      />
    </div>
  );
}
