import { cn } from '@/lib/cn';

/** A hairline. Vertical with `orientation="vertical"` inside a flex row. */
export function Rule({
  className,
  orientation = 'horizontal',
}: {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <hr
      aria-orientation={orientation}
      className={cn(
        'border-0 bg-rule',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-auto w-px self-stretch',
        className,
      )}
    />
  );
}
