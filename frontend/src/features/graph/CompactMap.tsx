import type { GraphSymbol } from '@/api/types';
import { Button } from '@/ui';
import type { Layout, LaidNode } from './layout';
import { graphStrings as t, kindLabel } from './strings';

type Props = {
  layout: Layout;
  onOpen: (symbol: GraphSymbol) => void;
  onFocus: (symbol: GraphSymbol) => void;
};

/**
 * A neighbourhood small enough to read as a list: the callers nearest the symbol last, so the
 * page reads down towards it and on past it into what it calls. Replaces the canvas, which
 * would draw a handful of boxes in a large frame.
 */
export function CompactMap({ layout, onOpen, onFocus }: Props) {
  const callers = byDistance(layout.nodes, 'caller').reverse();
  const calls = byDistance(layout.nodes, 'dependency');
  const center = layout.nodes.find((n) => n.role === 'center');

  return (
    <div className="flex max-w-prose flex-col gap-5">
      {callers.map(([depth, nodes]) => (
        <Hop key={`c${depth}`} depth={depth} nodes={nodes} onOpen={onOpen} onFocus={onFocus} />
      ))}
      {center && (
        <p className="border-y border-accent bg-accent-wash px-3 py-2 text-sm">
          <span className="font-mono text-ink">{center.symbol.name}</span>
          <span className="text-ink-3">
            {' '}
            · {center.symbol.filePath}:{center.symbol.lineStart}
          </span>
        </p>
      )}
      {calls.map(([depth, nodes]) => (
        <Hop key={`d${depth}`} depth={depth} nodes={nodes} onOpen={onOpen} onFocus={onFocus} />
      ))}
    </div>
  );
}

function byDistance(nodes: LaidNode[], role: LaidNode['role']) {
  const groups = new Map<number, LaidNode[]>();
  for (const n of nodes) {
    if (n.role !== role) continue;
    groups.set(n.depth, [...(groups.get(n.depth) ?? []), n]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function Hop({
  depth,
  nodes,
  onOpen,
  onFocus,
}: { depth: number; nodes: LaidNode[] } & Omit<Props, 'layout'>) {
  const caller = nodes[0]?.role === 'caller';
  return (
    <section>
      <h4 className="text-xs text-ink-3">{caller ? t.callersHop(depth) : t.callsHop(depth)}</h4>
      <ul className="mt-1">
        {nodes.map((n) => (
          <li key={n.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpen(n.symbol)}
              title={t.openInViewer}
              className="min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left hover:bg-paper-2"
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 truncate font-mono text-sm text-ink">{n.symbol.name}</span>
                <span className="shrink-0 text-xs text-ink-3">{kindLabel(n.symbol.kind)}</span>
              </span>
              <span className="block truncate font-mono text-xs text-ink-3">
                {n.symbol.filePath}:{n.symbol.lineStart}
              </span>
            </button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${t.center} ${n.symbol.name}`}
              onClick={() => onFocus(n.symbol)}
            >
              {t.center}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
