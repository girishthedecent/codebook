import type { Citation } from '@/api/types';
import { citationCaption } from '@/features/citations/citationTarget';
import { citationsOf, type FlashcardsData, type QuizData, type SummaryData } from './data';
import { s } from './strings';

// Plain-text renderings of a study set for download. Citations become the same captions a
// printed listing has ("model.py, lines 42–61"), since chip numbers mean nothing outside the app.

type Cited = { citations: number[] };

function captions(item: Cited, index: Map<number, Citation>) {
  return [...new Set(citationsOf(item, index).map(citationCaption))];
}

/** " (model.py, lines 42–61; Title, p. 9)", or nothing when the item cites nothing. */
function sourceNote(item: Cited, index: Map<number, Citation>) {
  const list = captions(item, index);
  return list.length > 0 ? ` (${list.join('; ')})` : '';
}

const csvCell = (text: string) => `"${text.replace(/"/g, '""')}"`;

/** Front, back and where it comes from, one card a row, with a header. */
export function flashcardsCsv(deck: FlashcardsData, index: Map<number, Citation>) {
  const rows = deck.cards.map((card) =>
    [card.front, card.back, captions(card, index).join('; ')].map(csvCell).join(','),
  );
  // CRLF is what spreadsheet programs expect from a CSV file.
  return [s.exports.csvHeader.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n';
}

/**
 * Anki's plain-text import: one note a line, front and back separated by a tab. Fields are
 * read as HTML, so line breaks become <br> and tabs inside a field turn into spaces.
 */
export function flashcardsAnki(deck: FlashcardsData) {
  const field = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\t/g, ' ')
      .replace(/\r?\n/g, '<br>');
  const header = ['#separator:tab', '#html:true', `#deck:${deck.title.replace(/\s+/g, ' ')}`];
  return (
    [...header, ...deck.cards.map((c) => `${field(c.front)}\t${field(c.back)}`)].join('\n') + '\n'
  );
}

/** "a", "b", "c": how a printed quiz labels its choices. */
export const choiceLetter = (i: number) => String.fromCharCode(97 + i);

/** The questions with their choices, then the answers with explanations, as a printed quiz has it. */
export function quizMarkdown(quiz: QuizData, title: string, index: Map<number, Citation>) {
  const lines = [`# ${title}`, ''];
  quiz.questions.forEach((q, n) => {
    lines.push(`${n + 1}. ${q.question}`, '');
    q.options.forEach((option, i) => lines.push(`   ${choiceLetter(i)}) ${option}`));
    lines.push('');
  });
  lines.push(`## ${s.exports.answers}`, '');
  quiz.questions.forEach((q, n) => {
    const answer = `${choiceLetter(q.answerIndex)}) ${q.options[q.answerIndex]}`;
    lines.push(`${n + 1}. **${answer}**. ${q.explanation}${sourceNote(q, index)}`, '');
  });
  return lines.join('\n');
}

export function summaryMarkdown(summary: SummaryData, title: string, index: Map<number, Citation>) {
  const lines = [`# ${title}`, ''];
  for (const section of summary.sections) {
    lines.push(`## ${section.heading}`, '');
    for (const bullet of section.bullets)
      lines.push(`- ${bullet.text}${sourceNote(bullet, index)}`);
    lines.push('');
  }
  if (summary.keyTerms.length > 0) {
    lines.push(`## ${s.summary.keyTerms}`, '');
    for (const t of summary.keyTerms) {
      lines.push(`**${t.term}**: ${t.definition}${sourceNote(t, index)}`, '');
    }
  }
  return lines.join('\n');
}
