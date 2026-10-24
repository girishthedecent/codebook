// Turns an HTML element into markdown-like text the doc chunker understands: `#` headings
// (h1–h4), list items, fenced code blocks with their language, tables as `a | b` rows.
// The walk keeps its own stack instead of recursing, so a hostile page nested thousands
// of levels deep costs time in proportion to its size and can't overflow the call stack.

type DomNode = {
  nodeType: number;
  localName?: string;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
  getAttribute?(name: string): string | null;
  querySelectorAll?(selector: string): ArrayLike<DomNode>;
};

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const DOCUMENT_NODE = 9;

const SKIPPED = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'button',
  'select',
  'input',
  'textarea',
]);
const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'blockquote',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'address',
  'form',
  'fieldset',
  'hr',
  'body',
]);

type Block = { text: string; tight: boolean };

/** The element's content as text with markdown structure. */
export function htmlToText(root: DomNode): string {
  const blocks: Block[] = [];
  let inline = '';
  // Set by a list item, used by the first block inside it.
  let prefix: string | null = null;
  const lists: { ordered: boolean; count: number }[] = [];

  const flush = () => {
    const text = inline.replace(/\s+/g, ' ').trim();
    inline = '';
    if (!text) return;
    if (prefix !== null) {
      blocks.push({ text: prefix + text, tight: true });
      prefix = null;
    } else {
      blocks.push({ text, tight: false });
    }
  };

  // Either a node to visit or a callback to run once its children are done.
  const stack: (DomNode | (() => void))[] = [root];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (typeof item === 'function') {
      item();
      continue;
    }
    if (item.nodeType === TEXT_NODE) {
      inline += item.textContent ?? '';
      continue;
    }
    if (item.nodeType !== ELEMENT_NODE && item.nodeType !== DOCUMENT_NODE) continue;

    const tag = item.localName ?? '';
    if (SKIPPED.has(tag)) continue;

    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      flush();
      const text = oneLine(item.textContent);
      const level = Number(heading[1]);
      // h5 and h6 are too fine-grained for sections; they stay as plain paragraphs.
      if (text)
        blocks.push({ text: level <= 4 ? `${'#'.repeat(level)} ${text}` : text, tight: false });
      continue;
    }
    if (tag === 'pre') {
      flush();
      const code = codeBlock(item);
      if (code) blocks.push({ text: code, tight: false });
      continue;
    }
    if (tag === 'table') {
      flush();
      const rows = tableRows(item);
      if (rows) blocks.push({ text: rows, tight: false });
      continue;
    }
    if (tag === 'code') {
      const text = oneLine(item.textContent);
      if (text) inline += `\`${text}\``;
      continue;
    }
    if (tag === 'br') {
      flush();
      continue;
    }

    let after: (() => void) | null = null;
    if (tag === 'ul' || tag === 'ol') {
      flush();
      lists.push({ ordered: tag === 'ol', count: 0 });
      after = () => {
        flush();
        lists.pop();
      };
    } else if (tag === 'li') {
      flush();
      const list = lists.at(-1);
      const indent = '  '.repeat(Math.max(0, lists.length - 1));
      if (list) list.count++;
      prefix = `${indent}${list?.ordered ? `${list.count}.` : '-'} `;
      after = () => {
        flush();
        prefix = null;
      };
    } else if (BLOCKS.has(tag)) {
      flush();
      after = flush;
    }

    if (after) stack.push(after);
    const children = item.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  flush();

  let text = '';
  blocks.forEach((block, i) => {
    if (i > 0) text += block.tight && blocks[i - 1]!.tight ? '\n' : '\n\n';
    text += block.text;
  });
  return text;
}

function oneLine(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

// The language from a `language-x` / `lang-x` class on the <pre> or its <code>.
function codeLanguage(pre: DomNode) {
  const code = pre.querySelectorAll?.('code')[0];
  for (const node of [pre, code]) {
    const match = /(?:^|\s)lang(?:uage)?-([\w+#.-]+)/.exec(node?.getAttribute?.('class') ?? '');
    if (match) return match[1]!;
  }
  return '';
}

// Code is kept exactly as written, inside a fence longer than any run of backticks in it.
// (trimEnd, not a /\s+$/ regex: that is quadratic on long runs of spaces.)
function codeBlock(pre: DomNode) {
  const code = (pre.textContent ?? '').replace(/^\n+/, '').trimEnd();
  if (!code.trim()) return null;
  let longest = 0;
  for (const run of code.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${codeLanguage(pre)}\n${code}\n${fence}`;
}

const ROW_GROUPS = new Set(['thead', 'tbody', 'tfoot']);

// The table's own rows and cells only: a table nested in a cell is part of that cell's text.
function tableRows(table: DomNode) {
  const elements = (node: DomNode) =>
    Array.from(node.childNodes).filter((child) => child.nodeType === ELEMENT_NODE);
  const rows = elements(table).flatMap((child) =>
    ROW_GROUPS.has(child.localName ?? '') ? elements(child) : [child],
  );
  const lines: string[] = [];
  for (const row of rows) {
    if (row.localName !== 'tr') continue;
    const cells = elements(row)
      .filter((cell) => cell.localName === 'td' || cell.localName === 'th')
      .map((cell) => oneLine(cell.textContent));
    if (cells.some(Boolean)) lines.push(cells.join(' | '));
  }
  return lines.join('\n');
}
