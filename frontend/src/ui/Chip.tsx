import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'error';

const tones: Record<Tone, string> = {
  neutral: 'border-rule-2 text-ink-2',
  accent: 'border-accent/40 bg-accent-wash text-accent',
  ok: 'border-ok/40 bg-ok-wash text-ok',
  warn: 'border-warn/40 bg-warn-wash text-warn',
  error: 'border-error/40 bg-error-wash text-error',
};

const base =
  'inline-flex items-center gap-1 rounded-full border text-xs leading-none whitespace-nowrap';

/** A small labelled mark: status, kind, count. Static by default. */
export function Chip({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn(base, 'h-6 px-2', tones[tone], className)} {...rest} />;
}

/**
 * A clickable chip, e.g. "Jump to latest" or a filter. 32px tall, with the hit area grown to
 * 40px by an invisible layer; neighbours need at least 8px between them.
 */
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
        'relative h-8 min-w-10 justify-center px-3 after:absolute after:inset-x-0 after:-inset-y-1 after:content-[""]',
        'transition-colors duration-150 ease-out',
        pressed ? tones.accent : tone === 'neutral' ? 'border-edge text-ink-2' : tones[tone],
        !pressed && 'hover:bg-paper-2',
        className,
      )}
      {...rest}
    />
  );
});
