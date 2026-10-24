import type { CitationRef, NewCitation } from './citations.types.js';

/** The same passage gets the same number however many tools return it. */
function dedupeKey(ref: NewCitation) {
  if (ref.chunkId) return `chunk:${ref.chunkId}`;
  if (ref.url && ref.kind === 'WEB') return `web:${ref.url}`;
  if (ref.lineStart !== undefined) {
    return `lines:${ref.sourceId}:${ref.path}:${ref.lineStart}-${ref.lineEnd}`;
  }
  if (ref.pageStart !== undefined) {
    return `pages:${ref.sourceId}:${ref.path}:${ref.pageStart}-${ref.pageEnd}`;
  }
  return `text:${ref.sourceId}:${ref.path}:${ref.text.slice(0, 200)}`;
}

/**
 * Numbers every passage a tool shows the model during one answer (or one study
 * generation), so the model can cite [n] and the answer can be checked against what it
 * actually saw.
 */
export class CitationRegistry {
  private readonly refs: CitationRef[] = [];
  private readonly byKey = new Map<string, number>();

  add(ref: NewCitation): number {
    const key = dedupeKey(ref);
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const n = this.refs.length + 1;
    this.refs.push({ ...ref, n });
    this.byKey.set(key, n);
    return n;
  }

  get(n: number): CitationRef | undefined {
    return this.refs[n - 1];
  }

  has(n: number) {
    return Number.isInteger(n) && n >= 1 && n <= this.refs.length;
  }

  all(): readonly CitationRef[] {
    return this.refs;
  }

  get size() {
    return this.refs.length;
  }
}

const attr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Source text is data the model reads, never markup it should trust: a passage containing
// "</source>" (or a fake opening tag) must not end its block or start a new one. The same
// goes for the <tool_result> blocks the agent wraps results in when it sends them as text.
export const neutralize = (text: string) => text.replace(/<(\/?)(source|tool_result)\b/gi, '‹$1$2');

/** The block a tool result shows the model for citation n. */
export function renderSource(ref: CitationRef, body = ref.text) {
  const attributes: [string, string | number | undefined][] = [
    ['n', ref.n],
    ['title', ref.sourceTitle],
    ['path', ref.kind === 'WEB' ? undefined : ref.path],
    ['url', ref.url],
    ['heading', ref.heading],
    ['pages', ref.pageStart === undefined ? undefined : pageRange(ref)],
    ['lines', ref.lineStart === undefined ? undefined : `${ref.lineStart}-${ref.lineEnd}`],
    ['external', ref.kind === 'WEB' ? 'true' : undefined],
  ];
  const head = attributes
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${name}="${attr(String(value))}"`)
    .join(' ');
  return `<source ${head}>\n${neutralize(body)}\n</source>`;
}

function pageRange(ref: CitationRef) {
  return ref.pageEnd === undefined || ref.pageEnd === ref.pageStart
    ? `${ref.pageStart}`
    : `${ref.pageStart}-${ref.pageEnd}`;
}
