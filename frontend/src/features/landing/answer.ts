import type { Citation } from '@/api/types';

// The answer is markdown with [n] markers. Only what the demo's answers use is read here:
// paragraphs, bullet lists, `code` and **bold**.

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'cite'; n: number };

export type Sentence = { parts: Part[]; cites: number[] };
export type Block = { list: boolean; sentences: Sentence[] };

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[(\d+(?:\s*,\s*\d+)*)\]/g;
const text = (value: string): Part => ({ kind: 'text', text: value });

function inlineParts(line: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index > last) parts.push(text(line.slice(last, m.index)));
    if (m[1]) parts.push({ kind: 'code', text: m[1] });
    else if (m[2]) parts.push({ kind: 'bold', text: m[2] });
    else for (const n of m[3]!.split(',')) parts.push({ kind: 'cite', n: Number(n) });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(text(line.slice(last)));
  return parts;
}

/** Cuts a paragraph after each sentence end, keeping the markers that follow the full stop. */
function sentencesOf(parts: Part[]): Sentence[] {
  const out: Sentence[] = [];
  let current: Part[] = [];
  let ended = false;
  const flush = () => {
    if (current.some((p) => p.kind !== 'text' || p.text.trim())) {
      out.push({
        parts: current,
        cites: current.flatMap((p) => (p.kind === 'cite' ? [p.n] : [])),
      });
    }
    current = [];
    ended = false;
  };
  for (const part of parts) {
    if (part.kind === 'cite') {
      current.push(part);
      continue;
    }
    if (ended) flush();
    if (part.kind !== 'text') {
      current.push(part);
      continue;
    }
    let rest = part.text;
    while (rest) {
      const stop = /[.!?]+(?=\s|$)/.exec(rest);
      if (!stop) {
        current.push(text(rest));
        break;
      }
      const cut = stop.index + stop[0].length;
      current.push(text(rest.slice(0, cut)));
      rest = rest.slice(cut);
      if (rest.trim() === '') {
        if (rest) current.push(text(rest));
        ended = true;
        break;
      }
      flush();
    }
  }
  flush();
  return out;
}

export function parseAnswer(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of markdown.split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim());
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      for (const line of lines) {
        blocks.push({
          list: true,
          sentences: sentencesOf(inlineParts(line.replace(/^\s*[-*]\s+/, ''))),
        });
      }
    } else {
      blocks.push({ list: false, sentences: sentencesOf(inlineParts(lines.join(' '))) });
    }
  }
  return blocks;
}

/** Citation numbers in the order the answer first uses them, which is how readers meet them. */
export function citationOrder(blocks: Block[]): number[] {
  const seen: number[] = [];
  for (const block of blocks) {
    for (const sentence of block.sentences) {
      for (const n of sentence.cites) if (!seen.includes(n)) seen.push(n);
    }
  }
  return seen;
}

export function locationOf(c: Citation): string {
  if (c.kind === 'PAGES' && c.pageStart) {
    return c.pageEnd && c.pageEnd !== c.pageStart
      ? `pp. ${c.pageStart}–${c.pageEnd}`
      : `p. ${c.pageStart}`;
  }
  if (c.kind === 'LINES' && c.path && c.lineStart) {
    const end = c.lineEnd && c.lineEnd !== c.lineStart ? `–${c.lineEnd}` : '';
    return `${c.path}, lines ${c.lineStart}${end}`;
  }
  return c.heading ?? c.sourceTitle;
}
