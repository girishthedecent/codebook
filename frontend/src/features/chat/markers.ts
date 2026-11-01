// Citation markers in answer text. The backend writes `[n]` or `[1, 2]`; one fallback model
// writes `【n†…】`, which the backend normalizes in saved messages but not in the live stream.
// The `n` is the registry number the citation is saved under. Readers see the notes numbered
// 1, 2, 3 in the order the text first cites them, so the two are kept apart: `citedOrder`
// gives that order, and nothing here changes what the URL carries.

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const FOREIGN = /【(\d+)†[^】]*】/g;
// Fenced blocks (closed or still streaming) and inline code are left alone.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

export const CITE_HREF = '#cite-';

/** The text cut into runs of prose and runs of code, in order. */
function* runs(text: string): Generator<{ code: boolean; text: string }> {
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    yield { code: false, text: text.slice(last, m.index) };
    yield { code: true, text: m[0] };
    last = m.index + m[0].length;
  }
  yield { code: false, text: text.slice(last) };
}

/**
 * Turns markers outside code into markdown links `[n](#cite-n)` so the markdown renderer can
 * hand them to the citation chip. `[1, 2]` becomes two links.
 */
export function linkCitations(markdown: string): string {
  const text = markdown.replace(FOREIGN, '[$1]');
  let out = '';
  for (const run of runs(text)) {
    out += run.code ? run.text : replaceMarkers(run.text);
  }
  return out;
}

function replaceMarkers(prose: string) {
  return prose.replace(MARKER, (_, list: string) =>
    list
      .split(',')
      .map((n) => `[${n.trim()}](${CITE_HREF}${n.trim()})`)
      .join(''),
  );
}

export function citeNumber(href: string | undefined): number | undefined {
  if (!href?.startsWith(CITE_HREF)) return undefined;
  const n = Number(href.slice(CITE_HREF.length));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** The registry numbers the text cites, each once, in the order they first appear. */
export function citedOrder(markdown: string): number[] {
  const seen = new Set<number>();
  for (const run of runs(markdown.replace(FOREIGN, '[$1]'))) {
    if (run.code) continue;
    for (const m of run.text.matchAll(MARKER)) {
      for (const part of m[1]!.split(',')) seen.add(Number(part));
    }
  }
  return [...seen];
}

/** The text with every marker outside code replaced by what `write` makes of its numbers. */
export function rewriteMarkers(
  markdown: string,
  write: (numbers: number[], marker: string) => string,
): string {
  let out = '';
  for (const run of runs(markdown.replace(FOREIGN, '[$1]'))) {
    out += run.code
      ? run.text
      : run.text.replace(MARKER, (marker, list: string) =>
          write(
            list.split(',').map((n) => Number(n)),
            marker,
          ),
        );
  }
  return out;
}

/** The same text with each marker written as the number the reader sees. */
export function renumberMarkers(markdown: string, shown: ReadonlyMap<number, number>): string {
  return rewriteMarkers(markdown, (registry, marker) => {
    const numbers = registry.map((n) => shown.get(n));
    return numbers.every((n) => n !== undefined) ? `[${numbers.join(', ')}]` : marker;
  });
}
