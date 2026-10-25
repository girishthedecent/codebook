import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Render the child element instead of a <button>, keeping the styles (for links). */
  asChild?: boolean;
};

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap select-none ' +
  'transition-colors duration-150 ease-out disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-paper hover:bg-accent-2 active:bg-accent-2',
  secondary: 'border border-rule-2 text-ink hover:bg-paper-2 active:bg-paper-3',
  ghost: 'text-ink-2 hover:bg-paper-2 hover:text-ink active:bg-paper-3',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    asChild = false,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : 'button'}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner className="size-3.5" />
          <span>{children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
});
