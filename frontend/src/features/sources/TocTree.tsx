import { useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { useSourceToc } from '@/api/queries/sources';
import type { TocNode } from '@/api/types';
import { cn } from '@/lib/cn';
import { Spinner } from '@/ui';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';

/**
 * The book's table of contents. Top-level parts start open, deeper levels closed; a title
 * opens the viewer at its first page.
 */
export function TocTree({ sourceId }: { sourceId: string }) {
  const toc = useSourceToc(sourceId);
  if (toc.isPending) return <Loading />;
  if (toc.isError) return <p className="py-4 text-sm text-error">{toc.error.message}</p>;
  if (toc.data.length === 0)
    return <p className="py-4 text-sm text-ink-3">{strings.detail.noToc}</p>;
  return (
    <ul role="tree" aria-label={strings.detail.contents} className="py-2">
      {toc.data.map((node) => (
        <TocItem key={node.id} node={node} sourceId={sourceId} depth={0} />
      ))}
    </ul>
  );
}

function TocItem({ node, sourceId, depth }: { node: TocNode; sourceId: string; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const openInViewer = useOpenInViewer();
  const hasChildren = node.children.length > 0;
  const page = node.pageStart;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={false}>
      <div
        className="flex min-h-9 items-baseline gap-1 border-b border-rule"
        style={{ paddingLeft: depth * 16 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`}
            className="flex size-6 shrink-0 translate-y-1 items-center justify-center rounded-xs text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <CaretRight
              size={12}
              className={cn('transition-transform duration-150', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        <button
          type="button"
          disabled={!page}
          onClick={() => page && openInViewer({ kind: 'page', sourceId, page })}
          className={cn(
            'flex min-w-0 flex-1 items-baseline justify-between gap-3 py-2 text-left',
            depth === 0 ? 'text-sm font-medium text-ink' : 'text-sm text-ink-2',
            !!page && 'hover:text-accent',
          )}
        >
          <span className="min-w-0">
            {node.number && (
              <span className="mr-2 font-mono text-xs text-ink-3">{node.number}</span>
            )}
            {node.title}
          </span>
          {page && (
            <span className="shrink-0 font-serif text-xs text-ink-3 [font-variant-numeric:oldstyle-nums]">
              {page}
            </span>
          )}
        </button>
      </div>
      {hasChildren && open && (
        <ul role="group">
          {node.children.map((child) => (
            <TocItem key={child.id} node={child} sourceId={sourceId} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-ink-3">
      <Spinner className="size-3.5" /> Loading
    </div>
  );
}
