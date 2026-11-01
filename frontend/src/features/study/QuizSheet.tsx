import type { Citation } from '@/api/types';
import { citationCaption } from '@/features/citations/citationTarget';
import { citationsOf, type QuizData } from './data';
import { choiceLetter } from './export';
import { s } from './strings';

/**
 * The quiz as a printed sheet: every question with its choices, then the answers on a page of
 * their own so they can be torn off. Only drawn for print (see study.css).
 */
export function QuizSheet({ quiz, index }: { quiz: QuizData; index: Map<number, Citation> }) {
  return (
    <div className="study-print-only">
      <ol className="flex flex-col gap-6">
        {quiz.questions.map((q, n) => (
          <li key={q.id} className="study-keep-together">
            <p className="font-serif text-base text-ink">
              <span className="text-ink-3">{n + 1}. </span>
              {q.question}
            </p>
            <ol className="mt-2 flex flex-col gap-1 pl-6 text-sm">
              {q.options.map((option, i) => (
                <li key={i}>
                  <span className="text-ink-3">{choiceLetter(i)}) </span>
                  {option}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>

      <section className="study-page-break">
        <h3 className="heading-section">{s.exports.answers}</h3>
        <ol className="mt-4 flex flex-col gap-3 text-sm">
          {quiz.questions.map((q, n) => {
            const sources = [...new Set(citationsOf(q, index).map(citationCaption))];
            return (
              <li key={q.id} className="study-keep-together">
                <span className="text-ink-3">{n + 1}. </span>
                <span className="font-medium text-ink">
                  {choiceLetter(q.answerIndex)}) {q.options[q.answerIndex]}.
                </span>{' '}
                <span className="text-ink-2">{q.explanation}</span>
                {sources.length > 0 && <span className="text-ink-3"> ({sources.join('; ')})</span>}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
