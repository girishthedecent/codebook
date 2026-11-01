import { useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { useSourceToc } from '@/api/queries/sources';
import type { TocNode } from '@/api/types';
import { cn } from '@/lib/cn';
import { Callout, EmptyState } from '@/ui';
import { ListSkeleton } from './ListSkeleton';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';

// A book with only a few top-level entries shows their sections too; a long one folds them.
const OPEN_BELOW = 5;
const PART = /^(part|book)\s+[ivxlc\d]+\b/i;

/**
 * The book's contents, set like a contents page: titles, dot leaders and the pages each
 * entry runs over. A title opens the viewer at its first page; deeper levels fold away.
 */
export function TocTree({ sourceId }: { sourceId: string }) {
  const toc = useSourceToc(sourceId);
  if (toc.isPending) return <ListSkeleton label="Loading the contents" />;
  if (toc.isError) return <Callout error={toc.error} onRetry={() => void toc.refetch()} />;
  if (toc.data.length === 0) return <EmptyState>{strings.detail.noToc}</EmptyState>;
  const startOpen = toc.data.length < OPEN_BELOW;
  return (
    <ul aria-label={strings.detail.contents} className="font-serif">
      {toc.data.map((node) => (
        <TocItem key={node.id} node={node} sourceId={sourceId} depth={0} startOpen={startOpen} />
      ))}
    </ul>
  );
}

function TocItem({
  node,
  sourceId,
  depth,
  startOpen,
}: {
  node: TocNode;
  sourceId: string;
  depth: number;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen && depth === 0);
  const openInViewer = useOpenInViewer();
  const hasChildren = node.children.length > 0;
  const page = node.pageStart;
  const part = depth === 0 && PART.test(node.title);

  return (
    <li className={cn(part && 'mt-5 first:mt-0')}>
      <div
        className="flex items-baseline"
        // Capped so a deep outline still leaves room for the title on a phone.
        style={{ paddingLeft: Math.min(depth, 4) * 20 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${open ? 'Fold' : 'Unfold'} ${node.title}`}
            className="-ml-1 flex size-8 shrink-0 translate-y-1.5 items-center justify-center self-start rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink max-sm:size-11 max-sm:translate-y-0 max-sm:self-center"
          >
            <CaretRight
              size={12}
              aria-hidden
              className={cn('transition-transform duration-150', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span aria-hidden className="w-7 shrink-0 max-sm:w-10" />
        )}
        <button
          type="button"
          disabled={!page}
          onClick={() => page && openInViewer({ kind: 'page', sourceId, page })}
          className={cn(
            'flex min-h-9 min-w-0 flex-1 items-baseline gap-2 py-1 text-left max-sm:min-h-11',
            depth === 0 && (part || hasChildren) ? 'text-base font-semibold' : 'text-base',
            depth > 0 && 'text-sm text-ink-2',
            !!page && 'hover:text-accent',
          )}
        >
          <span className="min-w-0 text-pretty [overflow-wrap:anywhere]">
            {node.number && <span className="mr-2 text-ink-3 oldstyle-nums">{node.number}.</span>}
            {node.title}
          </span>
          <span
            aria-hidden
            className="mb-1.5 min-w-4 flex-1 self-end border-b-2 border-dotted border-ink-3/40"
          />
          {page && (
            <span className="shrink-0 text-ink-2 oldstyle-nums">{pages(page, node.pageEnd)}</span>
          )}
        </button>
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((child) => (
            <TocItem
              key={child.id}
              node={child}
              sourceId={sourceId}
              depth={depth + 1}
              startOpen={false}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** "23–46" for a run of pages, "7" for one. */
function pages(start: number, end: number | null) {
  return end && end > start ? `${start}–${end}` : String(start);
}
