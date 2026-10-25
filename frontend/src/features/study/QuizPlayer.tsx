import { useState } from 'react';
import type { Citation } from '@/api/types';
import { Button, Kbd } from '@/ui';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';
import { useShortcut } from '@/lib/keyboard';
import { Cites } from './Cites';
import { citationsOf, type QuizData } from './data';
import { s } from './strings';

/**
 * One question per screen. Picking a choice locks it in and shows the answer with its
 * explanation and references; the result screen lists what was missed.
 */
export function QuizPlayer({ quiz, index }: { quiz: QuizData; index: Map<number, Citation> }) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [finished, setFinished] = useState(false);
  const keyboard = useBreakpoint() !== 'phone';

  const total = quiz.questions.length;
  const question = quiz.questions[at];
  const picked = question ? answers[question.id] : undefined;
  const answered = picked !== undefined;
  const last = at === total - 1;

  const pick = (choice: number) => {
    if (!question || answered || choice >= question.options.length) return;
    setAnswers((prev) => ({ ...prev, [question.id]: choice }));
  };
  const next = () => {
    if (!answered) return;
    if (last) setFinished(true);
    else setAt(at + 1);
  };
  const restart = () => {
    setAnswers({});
    setAt(0);
    setFinished(false);
  };

  useShortcut(['1', '2', '3', '4', '5', '6'], (e) => pick(Number(e.key) - 1), {
    enabled: !finished,
  });
  useShortcut('enter', next, { enabled: !finished && answered });

  if (total === 0) return null;

  if (finished) {
    const missed = quiz.questions.filter((q) => answers[q.id] !== q.answerIndex);
    return (
      <div className="max-w-[640px]">
        <p className="font-serif text-2xl">{s.quiz.score(total - missed.length, total)}</p>
        <p className="mt-1 text-sm text-ink-3">{s.quiz.scoreLabel}</p>
        {missed.length === 0 ? (
          <p className="mt-6 text-ink-2">{s.quiz.allRight}</p>
        ) : (
          <section aria-labelledby="missed" className="mt-8">
            <h3 id="missed" className="text-xs font-medium text-ink-3">
              {s.quiz.missed}
            </h3>
            <ol className="mt-2 border-t border-rule">
              {missed.map((q) => (
                <li key={q.id} className="border-b border-rule py-3">
                  <p className="font-serif text-base">{q.question}</p>
                  <p className="mt-1 text-sm">
                    <span className="text-ink-3">{s.quiz.answer}: </span>
                    {q.options[q.answerIndex]}
                  </p>
                  {answers[q.id] !== undefined && (
                    <p className="mt-0.5 text-sm text-ink-3">
                      {s.quiz.yourAnswer}: {q.options[answers[q.id]!]}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
        <Button className="mt-6" variant="secondary" onClick={restart}>
          {s.quiz.again}
        </Button>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="max-w-[640px]">
      <p className="flex items-baseline justify-between font-mono text-xs text-ink-3">
        <span>{s.quiz.of(at + 1, total)}</span>
        <span>{question.difficulty}</span>
      </p>
      <h3 className="mt-3 font-serif text-lg leading-snug font-normal">{question.question}</h3>

      <ol className="mt-5 border-t border-rule" aria-label="Choices">
        {question.options.map((option, i) => {
          const isAnswer = i === question.answerIndex;
          const isPicked = i === picked;
          return (
            <li key={i} className="border-b border-rule">
              <button
                type="button"
                onClick={() => pick(i)}
                disabled={answered}
                aria-pressed={isPicked}
                className={cn(
                  'flex min-h-11 w-full items-start gap-3 px-2 py-2.5 text-left text-sm transition-colors duration-150',
                  !answered && 'hover:bg-paper-2',
                  answered && isAnswer && 'bg-accent-wash',
                  answered && isPicked && !isAnswer && 'bg-error-wash',
                  answered && !isAnswer && !isPicked && 'text-ink-3',
                )}
              >
                <span className="w-4 shrink-0 pt-px font-mono text-xs text-ink-3">{i + 1}</span>
                <span className="flex-1">{option}</span>
                {answered && isAnswer && (
                  <span className="shrink-0 text-xs font-medium text-accent">{s.quiz.correct}</span>
                )}
                {answered && isPicked && !isAnswer && (
                  <span className="shrink-0 text-xs text-error">{s.quiz.yourAnswer}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {answered && (
        <div className="mt-5 border-l-2 border-rule-2 pl-4">
          <p className="prose text-ink-2">
            {question.explanation} <Cites citations={citationsOf(question, index)} />
          </p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-4">
        {keyboard ? (
          <p className="text-xs text-ink-3">
            <Kbd>1</Kbd>–<Kbd>4</Kbd> answer · <Kbd>Enter</Kbd> next
          </p>
        ) : (
          <span />
        )}
        <Button variant="primary" disabled={!answered} onClick={next}>
          {last ? s.quiz.finish : s.quiz.next}
        </Button>
      </div>
    </div>
  );
}
