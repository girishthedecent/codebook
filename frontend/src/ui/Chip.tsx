import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'error';

const tones: Record<Tone, string> = {
  neutral: 'border-rule-2 text-ink-2',
  accent: 'border-accent/40 bg-accent-wash text-accent',
  ok: 'border-ok/40 text-ok',
  warn: 'border-warn/40 text-warn',
  error: 'border-error/40 bg-error-wash text-error',
};

const base =
  'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs leading-none whitespace-nowrap';

/** A small labelled mark: status, kind, count. Static by default. */
export function Chip({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn(base, tones[tone], className)} {...rest} />;
}

/** A clickable chip, e.g. "Jump to latest" or a filter. */
export const ChipButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; pressed?: boolean }
>(function ChipButton({ tone = 'neutral', pressed, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      className={cn(
        base,
        tones[tone],
        'transition-colors duration-150 ease-out hover:bg-paper-2',
        pressed && 'bg-accent-wash border-accent/40 text-accent',
        className,
      )}
      {...rest}
    />
  );
});
