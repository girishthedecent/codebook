import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { controlClass } from '@/ui';

/** An inline title field: Enter or leaving the field saves, Escape cancels. */
export function RenameInput({
  initial,
  label,
  onDone,
  onCancel,
  className,
}: {
  initial: string;
  label: string;
  onDone: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (save) onDone(value.trim());
    else onCancel();
  };

  return (
    <input
      ref={ref}
      aria-label={label}
      value={value}
      maxLength={200}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      className={cn(controlClass, 'px-2', className)}
    />
  );
}
