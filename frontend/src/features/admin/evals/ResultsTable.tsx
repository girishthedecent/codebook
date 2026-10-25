import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CaretRight } from '@phosphor-icons/react';
import type { EvalResult } from '@/api/types';
import { cn } from '@/lib/cn';
import { ms } from '../format';
import { CaseDetail } from './CaseDetail';
import { typeLabel } from './metrics';

const cols =
  'grid grid-cols-[minmax(7rem,9rem)_7rem_minmax(16rem,1fr)_4.5rem_5rem_4.5rem] items-center gap-x-3';

/**
 * Per-case results, virtualized: a run can have hundreds of cases. Rows expand in place to
 * the full record; heights are measured, so expanded rows don't overlap.
 */
export function ResultsTable({ results }: { results: EvalResult[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = useVirtualizer({
    count: results.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 41,
    overscan: 8,
    getItemKey: (i) => results[i]!.id,
  });

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      ref={scroller}
      role="table"
      aria-label="Results per case"
      aria-rowcount={results.length + 1}
      className="-mx-4 max-h-[70vh] overflow-auto border-y border-rule px-4 sm:mx-0 sm:px-0"
    >
      <div className="min-w-[760px]">
        <div
          role="row"
          className={cn(
            cols,
            'sticky top-0 z-10 border-b border-rule-2 bg-paper py-2 text-xs font-medium text-ink-3',
          )}
        >
          <span role="columnheader" className="sticky left-0 bg-paper pl-6">
            Case
          </span>
          <span role="columnheader">Type</span>
          <span role="columnheader">Question</span>
          <span role="columnheader" className="text-right">
            Score
          </span>
          <span role="columnheader" className="text-right">
            Latency
          </span>
          <span role="columnheader">Result</span>
        </div>
        <div className="relative" style={{ height: rows.getTotalSize() }}>
          {rows.getVirtualItems().map((item) => {
            const r = results[item.index]!;
            const expanded = open.has(r.id);
            return (
              <div
                key={item.key}
                ref={rows.measureElement}
                data-index={item.index}
                role="row"
                aria-rowindex={item.index + 2}
                className="absolute inset-x-0 border-b border-rule"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <button
                  type="button"
                  onClick={() => toggle(r.id)}
                  aria-expanded={expanded}
                  className={cn(cols, 'group w-full py-2.5 text-left text-sm hover:bg-paper-2')}
                >
                  <span
                    role="cell"
                    className="sticky left-0 flex items-center gap-1.5 bg-paper group-hover:bg-paper-2 font-mono text-xs text-ink"
                  >
                    <CaretRight
                      size={12}
                      aria-hidden
                      className={cn(
                        'shrink-0 text-ink-3 transition-transform duration-150',
                        expanded && 'rotate-90',
                      )}
                    />
                    {r.externalId}
                  </span>
                  <span role="cell" className="font-mono text-xs text-ink-3">
                    {typeLabel(r.type)}
                  </span>
                  <span role="cell" className="truncate text-ink-2">
                    {r.question}
                  </span>
                  <span role="cell" className="text-right font-mono text-xs tabular-nums text-ink">
                    {r.score === null ? '—' : r.score.toFixed(2)}
                  </span>
                  <span
                    role="cell"
                    className="text-right font-mono text-xs tabular-nums text-ink-3"
                  >
                    {ms(r.latencyMs)}
                  </span>
                  <span
                    role="cell"
                    className={cn(
                      'text-xs',
                      r.error ? 'text-error' : r.failed ? 'text-error' : 'text-ink-3',
                    )}
                  >
                    {r.error ? 'error' : r.failed ? 'failed' : 'passed'}
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-rule px-6">
                    <CaseDetail result={r} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
