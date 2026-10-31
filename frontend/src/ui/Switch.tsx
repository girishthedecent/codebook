import { useId, type ReactNode } from 'react';
import { Switch as RadixSwitch } from 'radix-ui';
import { cn } from '@/lib/cn';

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** A labelled on/off switch. The label is part of the control, so the whole row is tappable. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: SwitchProps) {
  const id = useId();
  const descId = description ? `${id}-d` : undefined;
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-4', className)}>
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-sm text-ink">{label}</span>
        {description && (
          <span id={descId} className="text-xs text-ink-3">
            {description}
          </span>
        )}
      </label>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={descId}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border border-edge bg-paper-3 transition-colors duration-150 ease-out',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50',
        )}
      >
        <RadixSwitch.Thumb
          className={cn(
            'block size-[18px] translate-x-0.5 rounded-full bg-ink-3 transition-[transform,background-color] duration-150 ease-out',
            'data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-paper',
          )}
        />
      </RadixSwitch.Root>
    </div>
  );
}
