import { citationCaption, citationDestination } from '@/features/citations/citationTarget';
import { numberCitations } from '@/features/citations/numbering';
import type { ViewerTarget } from '@/lib/viewerParams';
import type { ExchangeView } from './Exchange';
import { rewriteMarkers } from './markers';
import { chat } from './strings';

export type TranscriptInput = {
  title: string;
  /** When the conversation began, as an ISO date. */
  startedAt: string;
  exchanges: ExchangeView[];
  /** A full address that opens this conversation with the viewer at the cited place. */
  linkFor: (target: ViewerTarget, cite: number, messageId?: string) => string;
};

// A question that fits on one plain line reads best as the heading itself; anything longer, or
// anything that starts like markdown (a quoted passage, a list), goes under a numbered heading.
function questionBlock(question: string, n: number) {
  const text = question.trim();
  const plain = !text.includes('\n') && text.length <= 120 && !/^([>#*+-]|\d+\.|```)/.test(text);
  return plain ? `## ${text}` : `## ${chat.export.question(n)}\n\n${text}`;
}

function answerBlock(view: ExchangeView, n: number, linkFor: TranscriptInput['linkFor']) {
  const { numbers, notes } = numberCitations(view.text, view.citations);
  const valid = new Set(notes.map((note) => note.citation.n));
  // Footnote labels carry the exchange too: every answer numbers its notes from 1.
  const label = (shown: number) => `[^${n}-${shown}]`;

  const body = rewriteMarkers(view.text, (registry, marker) => {
    const parts = registry.map((r) => {
      const shown = numbers.get(r);
      if (shown === undefined) return undefined;
      return valid.has(r) ? label(shown) : `[${shown}]`;
    });
    return parts.every((p) => p !== undefined) ? parts.join('') : marker;
  }).trim();

  const lines: string[] = [];
  if (body) lines.push(body);
  if (view.state === 'aborted') lines.push(`*${chat.export.stopped}*`);
  else if (view.state === 'error')
    lines.push(`*${body ? chat.export.unfinished : chat.export.noAnswer}*`);

  if (notes.length > 0) {
    const defs = notes.map(({ citation, shown }) => {
      const caption = citationCaption(citation);
      const dest = citationDestination(citation);
      const href =
        dest.kind === 'viewer'
          ? linkFor(dest.target, citation.n, view.messageId)
          : dest.kind === 'external'
            ? dest.url
            : undefined;
      return href
        ? `${label(shown)}: ${caption}, [${chat.export.open}](${href})`
        : `${label(shown)}: ${caption}`;
    });
    lines.push(defs.join('\n'));
  }
  return lines.join('\n\n');
}

/**
 * The conversation as a Markdown document: the title and date, then each question and its
 * answer, with the answer's citations as footnotes that link back into CodeBook.
 */
export function transcriptMarkdown({ title, startedAt, exchanges, linkFor }: TranscriptInput) {
  const date = new Date(startedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const blocks = [`# ${title}`, `*${date}*`];
  exchanges.forEach((view, i) => {
    if (view.question) blocks.push(questionBlock(view.question, i + 1));
    const answer = answerBlock(view, i + 1, linkFor);
    if (answer) blocks.push(answer);
  });
  return `${blocks.join('\n\n')}\n`;
}
