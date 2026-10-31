import { useId, type ReactNode } from 'react';
import { Checkbox as RadixCheckbox } from 'radix-ui';
import { Check, Minus } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';

export type CheckboxProps = {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** A labelled checkbox. The label is part of the control, so the whole row is tappable. */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: CheckboxProps) {
  const id = useId();
  const labelId = `${id}-l`;
  const descId = description ? `${id}-d` : undefined;
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-3 py-2.5',
        disabled && 'cursor-default opacity-50',
        className,
      )}
    >
      <RadixCheckbox.Root
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={descId}
        className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-xs border border-edge bg-paper text-paper transition-colors duration-150 ease-out hover:border-ink-3 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent"
      >
        <RadixCheckbox.Indicator>
          {checked === 'indeterminate' ? (
            <Minus size={12} weight="bold" aria-hidden />
          ) : (
            <Check size={12} weight="bold" aria-hidden />
          )}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <span className="flex flex-col gap-0.5">
        <span id={labelId} className="text-sm text-ink">
          {label}
        </span>
        {description && (
          <span id={descId} className="text-xs text-ink-3">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
