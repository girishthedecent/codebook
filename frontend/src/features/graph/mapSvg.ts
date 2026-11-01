import { NODE_HEIGHT, NODE_WIDTH, type Layout } from './layout';
import { graphStrings as t, kindLabel } from './strings';

const PAD = 24;
const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The theme's colours as they are now, since a saved file can't read the page's variables. */
function colours() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    paper: read('--paper', '#f6f3ec'),
    ink: read('--ink', '#1f1c18'),
    ink3: read('--ink-3', '#666057'),
    edge: read('--edge', '#857f73'),
    accent: read('--accent', '#2e5d4b'),
    accentWash: read('--accent-wash', 'rgb(46 93 75 / 0.1)'),
  };
}

/** Cuts a label to about what fits in a node; SVG has no ellipsis of its own. */
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The map as a standalone SVG: the same boxes, labels and arrows as the canvas, in the colours
 * of the current theme. Lit edges (a traced path) keep the accent.
 */
export function mapSvg(layout: Layout, title: string, highlight?: Set<string>): string {
  const c = colours();
  const boxes = [...layout.nodes, ...(layout.more ?? [])];
  const minX = Math.min(...boxes.map((n) => n.x));
  const minY = Math.min(...boxes.map((n) => n.y));
  const maxX = Math.max(...boxes.map((n) => n.x)) + NODE_WIDTH;
  const maxY = Math.max(...boxes.map((n) => n.y)) + NODE_HEIGHT;
  const width = Math.ceil(maxX - minX + PAD * 2);
  const height = Math.ceil(maxY - minY + PAD * 2);
  const at = new Map(boxes.map((n) => [n.id, n]));

  const edges = layout.edges.flatMap((e) => {
    const from = at.get(e.source);
    const to = at.get(e.target);
    if (!from || !to) return [];
    const lit = highlight?.has(e.source) && highlight.has(e.target);
    const x1 = from.x + NODE_WIDTH;
    const y1 = from.y + NODE_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_HEIGHT / 2;
    const mid = (x1 + x2) / 2;
    return [
      `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" fill="none" ` +
        `stroke="${lit ? c.accent : c.edge}" stroke-width="${lit ? 1.5 : 1}"` +
        `${e.muted ? ' stroke-dasharray="4 4"' : ''} marker-end="url(#${lit ? 'lit' : 'arrow'})" />`,
    ];
  });

  const nodes = layout.nodes.map((n) => {
    const strong = n.role === 'center' || highlight?.has(n.id);
    const { symbol } = n;
    return [
      `<g transform="translate(${n.x} ${n.y})">`,
      `<title>${escapeXml(`${kindLabel(symbol.kind)} ${symbol.name}, ${symbol.filePath}:${symbol.lineStart}`)}</title>`,
      `<rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="4" fill="${n.role === 'center' ? c.accentWash : c.paper}" stroke="${strong ? c.accent : c.edge}" />`,
      `<text x="10" y="21" font-family="IBM Plex Sans, system-ui, sans-serif" font-size="12" fill="${c.ink3}">${escapeXml(kindLabel(symbol.kind))}` +
        `<tspan font-family="IBM Plex Mono, ui-monospace, monospace" fill="${c.ink}"> ${escapeXml(clip(symbol.name, 26))}</tspan></text>`,
      `<text x="10" y="38" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" fill="${c.ink3}">${escapeXml(clip(`${symbol.filePath}:${symbol.lineStart}`, 34))}</text>`,
      '</g>',
    ].join('');
  });

  const more = (layout.more ?? []).map(
    (m) =>
      `<g transform="translate(${m.x} ${m.y})">` +
      `<rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="4" fill="${c.paper}" stroke="${c.ink3}" stroke-dasharray="4 3" />` +
      `<text x="10" y="30" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="12" fill="${c.ink}">${escapeXml(t.moreNode(m.count, m.side === 'caller'))}</text></g>`,
  );

  const marker = (id: string, colour: string) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${colour}" /></marker>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(title)}</title>`,
    `<defs>${marker('arrow', c.edge)}${marker('lit', c.accent)}</defs>`,
    `<rect width="100%" height="100%" fill="${c.paper}" />`,
    `<g transform="translate(${PAD - minX} ${PAD - minY})">`,
    ...edges,
    ...nodes,
    ...more,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
