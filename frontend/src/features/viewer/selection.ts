import type { CreateHighlightBody } from '@/api/queries/highlights';
import type { SourceType } from '@/api/types';
import type { ViewerTarget } from '@/lib/viewerParams';

/** What the reader selected, and where it sits, in the words a citation would use. */
export type Picked = {
  text: string;
  target: ViewerTarget;
  /** "Title, p. 157", "model.py, lines 42–61", "Title, Attention". */
  caption: string;
  highlight: CreateHighlightBody;
};

type Source = { title: string; type?: SourceType };

/**
 * Reads a selection inside the viewer. Only text in a part marked `data-selectable` counts
 * (a page's text, a file's lines, a web page's body), never the bars around them.
 */
export function describeSelection(
  range: Range,
  target: ViewerTarget,
  source: Source,
): Picked | undefined {
  const area = elementOf(range.commonAncestorContainer)?.closest('[data-selectable]');
  if (!area) return undefined;

  if (target.kind === 'page') {
    const text = clean(range.toString());
    if (!text) return undefined;
    return {
      text,
      target,
      caption: `${source.title}, p. ${target.page}`,
      highlight: { sourceId: target.sourceId, page: target.page, text },
    };
  }

  if (source.type === 'GITHUB_REPO') {
    const text = codeText(range).replace(/\s+$/, '');
    if (!text.trim()) return undefined;
    const first = lineOf(range.startContainer) ?? lineOf(area.querySelector('[data-line]'));
    const last = lineOf(range.endContainer) ?? first;
    if (first === undefined || last === undefined) return undefined;
    const [from, to] = first <= last ? [first, last] : [last, first];
    return {
      text,
      target: {
        kind: 'file',
        sourceId: target.sourceId,
        path: target.path,
        lineStart: from,
        lineEnd: to,
      },
      caption: linesCaption(target.path, from, to),
      highlight: {
        sourceId: target.sourceId,
        path: target.path,
        lineStart: from,
        lineEnd: to,
        text,
      },
    };
  }

  const text = clean(range.toString());
  if (!text) return undefined;
  const heading = headingBefore(area, range.startContainer);
  return {
    text,
    target: { kind: 'file', sourceId: target.sourceId, path: target.path, heading },
    caption: heading ? `${source.title}, ${heading}` : source.title,
    highlight: { sourceId: target.sourceId, path: target.path, heading, text },
  };
}

export function linesCaption(path: string, from: number, to: number) {
  return from === to ? `${path}, line ${from}` : `${path}, lines ${from}–${to}`;
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

function elementOf(node: Node | null) {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function lineOf(node: Node | null) {
  const row = elementOf(node)?.closest<HTMLElement>('[data-line]');
  const n = Number(row?.dataset.line);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * The selected code as lines, without the line numbers: the gutter can't be selected on
 * screen, but a copied range would still carry its digits.
 */
function codeText(range: Range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('[data-gutter]').forEach((el) => el.remove());
  const rows = fragment.querySelectorAll('[data-line]');
  if (!rows.length) return fragment.textContent ?? '';
  return [...rows].map((row) => row.textContent ?? '').join('\n');
}

/** The last heading at or before `node` in the page, as written. */
function headingBefore(area: Element, node: Node): string | undefined {
  let found: Element | undefined;
  for (const h of area.querySelectorAll('h1, h2, h3, h4')) {
    const after = h.compareDocumentPosition(node);
    if (h.contains(node) || after & Node.DOCUMENT_POSITION_FOLLOWING) found = h;
    else break;
  }
  const text = found?.textContent?.trim();
  return text || undefined;
}
