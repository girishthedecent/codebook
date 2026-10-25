import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

type Option<V extends string | number> = { value: V; label: string };

/** A row of mutually exclusive options on a hairline, keyboard-operable like a radio group. */
export function Segmented<V extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<V>[];
  value: V;
  onChange: (value: V) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((o) => o.value === value);

  const onKeyDown = (e: KeyboardEvent) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-10 items-stretch rounded-sm border border-rule-2 md:h-8"
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={onKeyDown}
          className={cn(
            'px-3 text-xs text-ink-2 transition-colors duration-150 ease-out hover:text-ink',
            i > 0 && 'border-l border-rule-2',
            o.value === value && 'bg-paper-3 font-medium text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
