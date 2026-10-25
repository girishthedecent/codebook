import type { GraphDependencies, GraphSymbol, GraphWalk } from '@/api/types';

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 50;
const COLUMN_GAP = 96;
const ROW_GAP = 14;

export type LaidNode = {
  id: string;
  symbol: GraphSymbol;
  x: number;
  y: number;
  role: 'center' | 'caller' | 'dependency' | 'path';
};

export type LaidEdge = { id: string; source: string; target: string };

/** `hidden` counts symbols left out because the neighbourhood was too big to draw. */
export type Layout = { nodes: LaidNode[]; edges: LaidEdge[]; hidden?: number };

// Past this many nodes the canvas is unreadable and slow; the nearest hops win.
export const MAX_NODES = 120;

type Reached = GraphWalk['symbols'][number];

/**
 * Layered layout without a layout library: one column per hop. Callers sit to the left of the
 * symbol (depth 1 nearest), dependencies to the right; inside a column, rows are sorted by file
 * and line so neighbours in the code end up near each other. Columns are centred on the symbol.
 */
export function layoutNeighborhood(
  center: GraphSymbol,
  callers: GraphWalk | undefined,
  dependencies: GraphDependencies | undefined,
): Layout {
  const nodes: LaidNode[] = [{ id: center.id, symbol: center, x: 0, y: 0, role: 'center' }];
  const edges: LaidEdge[] = [];
  const centerId = center.id;

  // The same symbol can be both a caller and a dependency (recursion, cycles), so ids are
  // prefixed by side.
  let hidden = 0;
  const place = (all: Reached[], side: -1 | 1, prefix: string) => {
    // Each side gets half the budget, nearest hops first.
    const budget = Math.floor((MAX_NODES - 1) / 2);
    const list = [...all].sort((a, b) => a.depth - b.depth).slice(0, budget);
    hidden += all.length - list.length;
    const byDepth = new Map<number, Reached[]>();
    for (const s of list) byDepth.set(s.depth, [...(byDepth.get(s.depth) ?? []), s]);
    for (const [depth, column] of byDepth) {
      column.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineStart - b.lineStart);
      const top = -((column.length - 1) * (NODE_HEIGHT + ROW_GAP)) / 2;
      column.forEach((s, row) => {
        nodes.push({
          id: prefix + s.id,
          symbol: s,
          x: side * depth * (NODE_WIDTH + COLUMN_GAP),
          y: top + row * (NODE_HEIGHT + ROW_GAP),
          role: side < 0 ? 'caller' : 'dependency',
        });
      });
    }
    for (const s of list) {
      // `via` is the symbol it was reached through; null means it's next to the center.
      const neighbour = s.via ? prefix + s.via : centerId;
      edges.push(
        side < 0
          ? { id: `e:${prefix}${s.id}`, source: prefix + s.id, target: neighbour }
          : { id: `e:${prefix}${s.id}`, source: neighbour, target: prefix + s.id },
      );
    }
  };

  if (callers) place(callers.symbols, -1, 'c:');
  if (dependencies) place(dependencies.symbols, 1, 'd:');

  // An edge whose `via` was cut off by the result cap would dangle; drop it.
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    hidden: hidden || undefined,
  };
}

/** A call chain as one row, left to right. */
export function layoutPath(path: GraphSymbol[]): Layout {
  const nodes = path.map((symbol, i): LaidNode => ({
    id: `p:${i}`,
    symbol,
    x: i * (NODE_WIDTH + COLUMN_GAP / 2),
    y: 0,
    role: 'path',
  }));
  const edges = path
    .slice(1)
    .map((_, i) => ({ id: `ep:${i}`, source: `p:${i}`, target: `p:${i + 1}` }));
  return { nodes, edges };
}
