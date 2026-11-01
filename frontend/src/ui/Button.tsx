import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
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
  'transition-colors duration-150 ease-out disabled:pointer-events-none';

const variants: Record<Variant, string> = {
  // Its own colours when disabled: a faded accent turns muddy on the dark theme's black.
  primary:
    'bg-accent text-paper hover:bg-accent-2 active:bg-accent-2 disabled:bg-off disabled:text-off-ink',
  secondary: 'border border-edge text-ink hover:bg-paper-2 active:bg-paper-3 disabled:opacity-50',
  danger:
    'border border-error text-error hover:bg-error-wash active:bg-error-wash disabled:opacity-50',
  ghost: 'text-ink-2 hover:bg-paper-2 hover:text-ink active:bg-paper-3 disabled:opacity-50',
};

// Phones get a 44px target whatever the size, so call sites never override the height.
const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs max-sm:h-11 max-sm:px-3',
  md: 'h-9 px-3.5 text-sm max-sm:h-11',
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
