import { cn } from '@/lib/cn';
import type { CodeSlice } from './fixtureTypes';

const tones: Record<string, string> = {
  kw: 'text-kind-book',
  fn: 'text-kind-repo',
  num: 'text-warn',
  str: 'text-ok',
  cm: 'text-ink-3 italic',
};

export type CodeListingProps = {
  slice: CodeSlice;
  /** Show only these line numbers (inclusive). */
  from?: number;
  to?: number;
  /** Lines to mark as the cited ones. */
  mark?: [number, number];
  className?: string;
};

/** Source lines with their numbers, coloured from the captured tokens. */
export function CodeListing({ slice, from, to, mark, className }: CodeListingProps) {
  const first = from ?? slice.lineStart;
  const last = to ?? slice.lineEnd;
  return (
    <pre
      className={cn('m-0 overflow-x-auto font-mono text-xs leading-[1.65] text-ink', className)}
      role="region"
      aria-label="Code listing"
      // A scrollable region has to be focusable for keyboard users.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      <code className="block min-w-max">
        {slice.lines.map((tokens, i) => {
          const n = slice.lineStart + i;
          if (n < first || n > last) return null;
          const cited = mark && n >= mark[0] && n <= mark[1];
          return (
            <span
              key={n}
              className={cn(
                'flex min-h-[1.65em] border-l-2 pr-4',
                cited ? 'border-accent bg-highlight' : 'border-transparent',
              )}
            >
              <span
                aria-hidden
                className="w-10 shrink-0 pr-3 text-right text-ink-3 select-none tabular-nums"
              >
                {n}
              </span>
              <span className="whitespace-pre">
                {tokens.map(([text, kind], j) => (
                  <span key={j} className={tones[kind]}>
                    {text}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </code>
    </pre>
  );
}
