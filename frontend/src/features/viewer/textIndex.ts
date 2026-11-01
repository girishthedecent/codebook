import type { Range as TextRange } from './findSnippet';

/**
 * The text under an element as one string, with a way back from a position in it to a DOM
 * range. Blocks and line breaks become a space between their words; inline elements (a bold
 * word, one run of pdf.js text) join without one, so a word split across elements still reads
 * as one word.
 */
export type TextIndex = {
  text: string;
  toRange: (range: TextRange) => Range | undefined;
};

const BLOCKS = new Set([
  'P',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'BLOCKQUOTE',
  'TD',
  'TH',
  'TR',
  'DIV',
  'UL',
  'OL',
  'TABLE',
  'DT',
  'DD',
  'BR',
]);

export function indexText(root: Element): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  let gap = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (BLOCKS.has((n as Element).tagName)) gap = true;
      continue;
    }
    const data = (n as Text).data;
    if (!data) continue;
    if (gap && text && !/\s$/.test(text)) text += ' ';
    gap = false;
    nodes.push(n as Text);
    starts.push(text.length);
    text += data;
  }

  const at = (offset: number, end: boolean) => {
    // An offset in a gap between nodes belongs to the node before it when it ends a range.
    let i = starts.findLastIndex((start) => (end ? start < offset : start <= offset));
    if (i < 0) i = 0;
    const node = nodes[i]!;
    return { node, offset: Math.max(0, Math.min(offset - starts[i]!, node.length)) };
  };

  return {
    text,
    toRange: ({ start, end }) => {
      if (!nodes.length || end <= start) return undefined;
      const from = at(start, false);
      const to = at(end, true);
      const range = document.createRange();
      try {
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
      } catch {
        return undefined;
      }
      return range;
    },
  };
}

// The CSS Custom Highlight API paints ranges without touching the nodes React or pdf.js own.
// Browsers without it still count and scroll to find hits; they just don't tint them.
const supported = () => typeof Highlight !== 'undefined' && 'highlights' in CSS;

/** Names of the painted layers; viewer.css gives each its colour. Later ones paint on top. */
export const layers = ['cb-cited', 'cb-mark', 'cb-find', 'cb-find-now'] as const;
export type Layer = (typeof layers)[number];

export function paint(layer: Layer, ranges: Range[]) {
  if (!supported()) return;
  if (!ranges.length) {
    CSS.highlights.delete(layer);
    return;
  }
  const highlight = new Highlight(...ranges);
  highlight.priority = layers.indexOf(layer);
  CSS.highlights.set(layer, highlight);
}

export function unpaint(...names: Layer[]) {
  if (!supported()) return;
  for (const name of names) CSS.highlights.delete(name);
}
