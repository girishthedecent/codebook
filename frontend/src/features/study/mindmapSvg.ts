import type { MindmapNode } from './data';
import { edge, FONT, layout, PAD, ROOT_FONT, ROW } from './mapLayout';

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
  };
}

/**
 * The whole map, every branch unfolded, as a standalone SVG drawn the way the page draws it.
 * Labels keep the shortening the page applies; each node's full label is its <title>.
 */
export function mindmapSvg(root: MindmapNode): string {
  const nodes = layout(root, new Set());
  const c = colours();
  let width = 0;
  let height = 0;
  for (const n of nodes) {
    width = Math.max(width, n.x + n.width + 40);
    height = Math.max(height, n.y);
  }
  const w = Math.ceil(width + PAD * 2);
  const h = Math.ceil(height + ROW + PAD * 2);

  const edges = nodes
    .filter((n) => n.parent)
    .map((n) => `<path d="${edge(n.parent!, n)}" fill="none" stroke="${c.edge}" />`);
  const labels = nodes.map((n) => {
    const root = !n.parent;
    const dot = n.node.children.length > 0 ? c.accent : c.ink3;
    return (
      `<g transform="translate(${n.x} ${n.y})"><title>${escapeXml(n.node.label)}</title>` +
      `<circle r="${root ? 3.5 : 2.5}" fill="${dot}" />` +
      `<text x="9" y="4.5" fill="${c.ink}" style='font: ${root ? ROOT_FONT : FONT}'>${escapeXml(n.label)}</text></g>`
    );
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<title>${escapeXml(root.label)}</title>`,
    `<rect width="100%" height="100%" fill="${c.paper}" />`,
    `<g transform="translate(${PAD} ${PAD + ROW / 2})">`,
    ...edges,
    ...labels,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
