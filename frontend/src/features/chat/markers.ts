// Citation markers in answer text. The backend writes `[n]` or `[1, 2]`; one fallback model
// writes `【n†…】`, which the backend normalizes in saved messages but not in the live stream.

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const FOREIGN = /【(\d+)†[^】]*】/g;
// Fenced blocks (closed or still streaming) and inline code are left alone.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

export const CITE_HREF = '#cite-';

/**
 * Turns markers outside code into markdown links `[n](#cite-n)` so the markdown renderer can
 * hand them to the citation chip. `[1, 2]` becomes two links.
 */
export function linkCitations(markdown: string): string {
  const text = markdown.replace(FOREIGN, '[$1]');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    out += replaceMarkers(text.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }
  return out + replaceMarkers(text.slice(last));
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
