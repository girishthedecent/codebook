import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { GraphSymbol } from '@/api/types';
import { Input, Spinner } from '@/ui';
import { cn } from '@/lib/cn';
import { useDebounced, useSymbolMatches } from './hooks';
import { SymbolLine } from './SymbolLine';
import { graphStrings as t } from './strings';

type Props = {
  repo: string;
  label: string;
  placeholder?: string;
  /** Shown in the input when nothing is being typed, e.g. the picked symbol's name. */
  selectedName?: string;
  onPick: (symbol: GraphSymbol) => void;
  className?: string;
};

/**
 * A search box with a listbox of matching symbols. Arrow keys move, Enter picks, Escape
 * closes. Results come from the backend's name / qualified-name search, debounced 200 ms.
 */
export function SymbolCombobox({
  repo,
  label,
  placeholder,
  selectedName,
  onPick,
  className,
}: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 200);
  const matches = useSymbolMatches(repo, q);
  const items = matches.data ?? [];
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const showList = open && q.length > 0;

  const pick = (s: GraphSymbol) => {
    onPick(s);
    setText('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && showList && items[active]) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <label className="sr-only" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <Input
        ref={inputRef}
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={selectedName ?? placeholder ?? t.searchPlaceholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={cn('font-mono text-xs', selectedName && 'placeholder:text-ink')}
      />
      {matches.isFetching && q && (
        <Spinner className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2" />
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-rule-2 bg-paper py-1 shadow-float"
        >
          {matches.isError && (
            <li role="alert" className="px-3 py-2 text-xs text-error">
              {t.searchError}
            </li>
          )}
          {items.length === 0 && !matches.isFetching && !matches.isError && (
            <li className="px-3 py-2 text-xs text-ink-3">{t.noMatches}</li>
          )}
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5 md:min-h-0',
                i === active && 'bg-paper-2',
              )}
            >
              <SymbolLine symbol={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
