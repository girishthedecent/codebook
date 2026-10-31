import { cn } from '@/lib/cn';

const sizes = { sm: 'text-base', md: 'text-lg', lg: 'text-xl' };

/** The name, set in the serif: Code upright, Book in the green italic. Plain markup, no router. */
export function Wordmark({
  size = 'md',
  className,
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'font-serif leading-none font-semibold tracking-tight text-ink',
        sizes[size],
        className,
      )}
    >
      Code<span className="font-normal text-accent italic">Book</span>
    </span>
  );
}
