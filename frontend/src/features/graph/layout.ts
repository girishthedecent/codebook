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
  /** Calls away from the centre; 0 for the centre and for a path. */
  depth: number;
};

export type LaidEdge = { id: string; source: string; target: string; muted?: boolean };

/** A stand-in for the symbols a side had no room for: "+N more callers". */
export type MoreMarker = {
  id: string;
  x: number;
  y: number;
  count: number;
  side: 'caller' | 'dependency';
};

/**
 * `hidden` counts symbols left out because the neighbourhood was too big to draw; `more` holds
 * one marker per side that was cut.
 */
export type Layout = {
  nodes: LaidNode[];
  edges: LaidEdge[];
  more?: MoreMarker[];
  hidden?: number;
};

// More than this on one side and the labels shrink past reading; the nearest hops win.
export const SIDE_CAP = 12;

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
  const nodes: LaidNode[] = [
    { id: center.id, symbol: center, x: 0, y: 0, role: 'center', depth: 0 },
  ];
  const edges: LaidEdge[] = [];
  const centerId = center.id;

  // The same symbol can be both a caller and a dependency (recursion, cycles), so ids are
  // prefixed by side.
  let hidden = 0;
  const more: MoreMarker[] = [];
  const place = (all: Reached[], side: -1 | 1, prefix: string) => {
    // Nearest hops first.
    const list = [...all].sort((a, b) => a.depth - b.depth).slice(0, SIDE_CAP);
    const left = all.length - list.length;
    hidden += left;
    const byDepth = new Map<number, Reached[]>();
    for (const s of list) byDepth.set(s.depth, [...(byDepth.get(s.depth) ?? []), s]);
    const nearest = Math.min(...byDepth.keys());
    for (const [depth, column] of byDepth) {
      column.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineStart - b.lineStart);
      // The marker takes one more row at the bottom of the nearest column.
      const rows = column.length + (left > 0 && depth === nearest ? 1 : 0);
      const top = -((rows - 1) * (NODE_HEIGHT + ROW_GAP)) / 2;
      column.forEach((s, row) => {
        nodes.push({
          id: prefix + s.id,
          symbol: s,
          x: side * depth * (NODE_WIDTH + COLUMN_GAP),
          y: top + row * (NODE_HEIGHT + ROW_GAP),
          role: side < 0 ? 'caller' : 'dependency',
          depth,
        });
      });
      if (left > 0 && depth === nearest) {
        const id = `more:${prefix}`;
        more.push({
          id,
          x: side * depth * (NODE_WIDTH + COLUMN_GAP),
          y: top + column.length * (NODE_HEIGHT + ROW_GAP),
          count: left,
          side: side < 0 ? 'caller' : 'dependency',
        });
        edges.push(
          side < 0
            ? { id: `e:${id}`, source: id, target: centerId, muted: true }
            : { id: `e:${id}`, source: centerId, target: id, muted: true },
        );
      }
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
  const ids = new Set([...nodes.map((n) => n.id), ...more.map((m) => m.id)]);
  return {
    nodes,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    more: more.length ? more : undefined,
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
    depth: 0,
  }));
  const edges = path
    .slice(1)
    .map((_, i) => ({ id: `ep:${i}`, source: `p:${i}`, target: `p:${i + 1}` }));
  return { nodes, edges };
}

/** The space the laid-out nodes take up, so a canvas can be sized to its content. */
export function layoutSize(layout: Layout) {
  const placed = [...layout.nodes, ...(layout.more ?? [])];
  if (placed.length === 0) return { width: NODE_WIDTH, height: NODE_HEIGHT };
  const xs = placed.map((n) => n.x);
  const ys = placed.map((n) => n.y);
  return {
    width: Math.max(...xs) - Math.min(...xs) + NODE_WIDTH,
    height: Math.max(...ys) - Math.min(...ys) + NODE_HEIGHT,
  };
}
