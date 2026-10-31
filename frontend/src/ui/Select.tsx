import { forwardRef, type SelectHTMLAttributes } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { controlClass, useControlProps } from './Field';

/**
 * A native select in the field's look, so phones get their own picker. Inside a `Field` it
 * is labelled like an Input. `className` goes on the wrapper: size it there (`w-fit`).
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className={cn('relative', className)}>
        <select
          ref={ref}
          className={cn(controlClass, 'h-9 appearance-none pr-9 max-sm:h-11')}
          {...useControlProps()}
          {...rest}
        >
          {children}
        </select>
        <CaretDown
          size={14}
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-3"
        />
      </div>
    );
  },
);
