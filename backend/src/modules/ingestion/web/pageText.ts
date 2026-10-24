import { closesFence, openingFence, type Fence } from '../code/markdown.chunker.js';
import type { AtomicRange } from '../doc.chunker.js';

/** Text as it is stored: no NULs (Postgres refuses them), no BOM or \r, no page breaks. */
export function cleanPageText(text: string) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replaceAll('\0', '')
    .replaceAll('\f', ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fenced code blocks, so the chunker keeps each in one piece. An unclosed fence runs to the end. */
export function fencedBlocks(text: string): AtomicRange[] {
  const blocks: AtomicRange[] = [];
  let open: { start: number; fence: Fence } | null = null;
  let offset = 0;
  for (const line of text.split('\n')) {
    if (open === null) {
      const fence = openingFence(line);
      if (fence) open = { start: offset, fence };
    } else if (closesFence(line, open.fence)) {
      blocks.push({ start: open.start, end: offset + line.length });
      open = null;
    }
    offset += line.length + 1;
  }
  if (open) blocks.push({ start: open.start, end: text.length });
  return blocks;
}

/**
 * A fetched body as text, in the order browsers pick the encoding: a byte order mark, the
 * Content-Type charset, a `<meta charset>` (or http-equiv) in the first 1,024 bytes, UTF-8.
 */
export function decodeBody(body: Buffer, headerCharset: string | null) {
  const bom =
    body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf
      ? 'utf-8'
      : body[0] === 0xff && body[1] === 0xfe
        ? 'utf-16le'
        : body[0] === 0xfe && body[1] === 0xff
          ? 'utf-16be'
          : null;
  // A page can't declare itself UTF-16 from inside: the declaration was readable as ASCII.
  const declared = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i
    .exec(body.subarray(0, 1024).toString('latin1'))?.[1]
    ?.replace(/^utf-16.*/i, 'utf-8');
  for (const label of [bom, headerCharset, declared]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // Not a label TextDecoder knows; try the next source.
    }
  }
  return new TextDecoder('utf-8').decode(body);
}
