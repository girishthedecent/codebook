import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { cn } from '@/lib/cn';

export type RadioOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type RadioGroupProps = Omit<
  ComponentPropsWithoutRef<typeof RadixRadioGroup.Root>,
  'children'
> & {
  options: RadioOption[];
};

/** One choice of several, as labelled rows. Name the group with `aria-label` or `aria-labelledby`. */
export function RadioGroup({ options, className, ...rest }: RadioGroupProps) {
  const id = useId();
  return (
    <RadixRadioGroup.Root className={cn('flex flex-col', className)} {...rest}>
      {options.map((o) => {
        const labelId = `${id}-${o.value}`;
        const descId = o.description ? `${labelId}-d` : undefined;
        return (
          <label
            key={o.value}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 py-2.5',
              o.disabled && 'cursor-default opacity-50',
            )}
          >
            <RadixRadioGroup.Item
              value={o.value}
              disabled={o.disabled}
              aria-labelledby={labelId}
              aria-describedby={descId}
              className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border border-edge bg-paper transition-colors duration-150 ease-out hover:border-ink-3 data-[state=checked]:border-accent"
            >
              <RadixRadioGroup.Indicator className="size-2.5 rounded-full bg-accent" />
            </RadixRadioGroup.Item>
            <span className="flex flex-col gap-0.5">
              <span id={labelId} className="text-sm text-ink">
                {o.label}
              </span>
              {o.description && (
                <span id={descId} className="text-xs text-ink-3">
                  {o.description}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </RadixRadioGroup.Root>
  );
}
