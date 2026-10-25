import { useEffect, useMemo, useRef, useState } from 'react';
import type { Citation } from '@/api/types';
import { Button, Kbd, ProgressRule } from '@/ui';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';
import { useShortcut } from '@/lib/keyboard';
import { Cites } from './Cites';
import { citationsOf, type QuizData } from './data';
import { s } from './strings';

type Progress = { at: number; answers: Record<string, number>; finished: boolean };

// A reload or a trip to the viewer shouldn't throw away a half-finished quiz.
function loadProgress(key: string, quiz: QuizData): Progress | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Progress;
    const ok =
      Number.isInteger(p.at) && p.at >= 0 && p.at < quiz.questions.length && p.answers !== null;
    return ok && typeof p.answers === 'object' ? p : undefined;
  } catch {
    return undefined;
  }
}

function saveProgress(key: string, p: Progress | undefined) {
  try {
    if (p) sessionStorage.setItem(key, JSON.stringify(p));
    else sessionStorage.removeItem(key);
  } catch {
    // Storage can be blocked; the quiz just won't survive a reload.
  }
}

/**
 * One question per screen. Picking a choice locks it in and shows the answer with its
 * explanation and references; the result screen lists what was missed.
 */
export function QuizPlayer({
  quiz,
  index,
  storageKey,
}: {
  quiz: QuizData;
  index: Map<number, Citation>;
  /** Where progress is kept for this tab; the key changes when the set is regenerated. */
  storageKey: string;
}) {
  const saved = useMemo(() => loadProgress(storageKey, quiz), [storageKey, quiz]);
  const [at, setAt] = useState(saved?.at ?? 0);
  const [answers, setAnswers] = useState<Record<string, number>>(saved?.answers ?? {});
  const [finished, setFinished] = useState(saved?.finished ?? false);
  const [resumed] = useState(Boolean(saved) && !saved?.finished);
  useEffect(() => {
    const started = finished || at > 0 || Object.keys(answers).length > 0;
    saveProgress(storageKey, started ? { at, answers, finished } : undefined);
  }, [storageKey, at, answers, finished]);
  const keyboard = useBreakpoint() !== 'phone';
  // After "Next", focus moves to the new question so keyboard and screen-reader users start
  // there; otherwise it would stay on whichever choice was last pressed.
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [at]);

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
                  <p className="mt-1.5 text-sm text-ink-2">
                    {q.explanation} <Cites citations={citationsOf(q, index)} />
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}
        <Button className="mt-6 h-11! sm:h-9!" variant="secondary" onClick={restart}>
          {s.quiz.again}
        </Button>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="max-w-[640px]">
      {resumed && <p className="mb-2 text-xs text-ink-3">{s.quiz.resumed}</p>}
      <p className="flex items-baseline justify-between font-mono text-xs text-ink-3">
        <span>{s.quiz.of(at + 1, total)}</span>
        <span>{question.difficulty}</span>
      </p>
      <ProgressRule
        className="mt-2"
        label={s.quiz.of(at + 1, total)}
        value={(at + (answered ? 1 : 0)) / total}
      />
      <h3
        ref={heading}
        tabIndex={-1}
        className="mt-4 font-serif text-lg leading-snug font-normal outline-none"
      >
        {question.question}
      </h3>

      <ol className="mt-5 border-t border-rule" aria-label="Choices">
        {question.options.map((option, i) => {
          const isAnswer = i === question.answerIndex;
          const isPicked = i === picked;
          return (
            <li key={i} className="border-b border-rule">
              <button
                type="button"
                onClick={() => pick(i)}
                // aria-disabled, not disabled, so focus stays on the choice that was pressed.
                aria-disabled={answered || undefined}
                aria-pressed={isPicked}
                className={cn(
                  'flex min-h-11 w-full items-start gap-3 px-2 py-2.5 text-left text-sm transition-colors duration-150',
                  answered ? 'cursor-default' : 'hover:bg-paper-2',
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
        <div role="status" className="mt-5 border-l-2 border-rule-2 pl-4">
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
        <Button variant="primary" className="h-11! sm:h-9!" disabled={!answered} onClick={next}>
          {last ? s.quiz.finish : s.quiz.next}
        </Button>
      </div>
    </div>
  );
}
