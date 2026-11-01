import type { MindmapNode } from './data';

// The map: columns by depth, leaves one row apart, each parent centred on its children.

const COL = 240;
export const ROW = 34;
export const PAD = 24;
const MAX_LABEL = 210;
export const FONT = '13px "IBM Plex Sans", system-ui, sans-serif';
export const ROOT_FONT = '600 14px "IBM Plex Sans", system-ui, sans-serif';

export type Placed = {
  node: MindmapNode;
  x: number;
  y: number;
  label: string;
  width: number;
  depth: number;
  parent?: Placed;
  kids: Placed[];
  folded: boolean;
};

let ctx: CanvasRenderingContext2D | null | undefined;
function measure(text: string, font: string) {
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 6.8;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Shortens a label to fit the column, on a word boundary when there is one. */
function fit(label: string, font: string): { label: string; width: number } {
  let width = measure(label, font);
  if (width <= MAX_LABEL) return { label, width };
  let cut = label;
  while (cut.length > 4 && measure(cut + '…', font) > MAX_LABEL) {
    const space = cut.lastIndexOf(' ', cut.length - 2);
    cut = space > cut.length * 0.6 ? cut.slice(0, space) : cut.slice(0, -1);
  }
  cut = cut.trimEnd() + '…';
  width = measure(cut, font);
  return { label: cut, width };
}

export function layout(root: MindmapNode, folded: Set<string>): Placed[] {
  const placed: Placed[] = [];
  let row = 0;
  const walk = (node: MindmapNode, depth: number, parent?: Placed): Placed => {
    const font = depth === 0 ? ROOT_FONT : FONT;
    const { label, width } = fit(node.label, font);
    const isFolded = folded.has(node.id) && node.children.length > 0;
    const me: Placed = {
      node,
      x: depth * COL,
      y: 0,
      label,
      width,
      depth,
      parent,
      kids: [],
      folded: isFolded,
    };
    placed.push(me);
    const kids = isFolded ? [] : node.children.map((child) => walk(child, depth + 1, me));
    me.kids = kids;
    if (kids.length === 0) me.y = row++ * ROW;
    else me.y = (kids[0]!.y + kids[kids.length - 1]!.y) / 2;
    return me;
  };
  walk(root, 0);
  return placed;
}

/** A soft S-curve from the end of the parent's label to the child's dot. */
export function edge(from: Placed, to: Placed) {
  const x1 = from.x + from.width + 16;
  const x2 = to.x - 6;
  const mid = (x1 + x2) / 2;
  return `M${x1},${from.y} C${mid},${from.y} ${mid},${to.y} ${x2},${to.y}`;
}
