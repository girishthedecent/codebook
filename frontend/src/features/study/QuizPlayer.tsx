import { useEffect, useMemo, useRef, useState } from 'react';
import { useRecordAttempt, type AttemptMark, type RecordAttemptBody } from '@/api/queries/study';
import type { Citation } from '@/api/types';
import { Button, Kbd, ProgressRule, TextButton } from '@/ui';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';
import { useShortcut } from '@/lib/keyboard';
import { RecentAttempts } from './AttemptHistory';
import { Cites } from './Cites';
import { citationsOf, type QuizData } from './data';
import { s } from './strings';

type Progress = {
  at: number;
  answers: Record<string, number>;
  finished: boolean;
  /** The questions of a round that goes over the missed ones; absent for the whole quiz. */
  only?: string[];
  /** The score before this round, so the result can say how it went last time. */
  previous?: AttemptMark | null;
};

// A reload or a trip to the viewer shouldn't throw away a half-finished quiz.
function loadProgress(key: string, quiz: QuizData): Progress | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Progress;
    const only = Array.isArray(p.only) ? p.only : undefined;
    const length = only ? only.length : quiz.questions.length;
    const ok =
      Number.isInteger(p.at) &&
      p.at >= 0 &&
      p.at < length &&
      typeof p.answers === 'object' &&
      p.answers !== null;
    return ok ? { ...p, only } : undefined;
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

type Props = {
  quiz: QuizData;
  index: Map<number, Citation>;
  /** Where progress is kept for this tab; the key changes when the set is regenerated. */
  storageKey: string;
  workspaceId: string;
  studyId: string;
  /** The requester's last finished run, as the server had it when the set loaded. */
  lastAttempt: AttemptMark | null;
};

/**
 * One question per screen. Picking a choice locks it in and shows the answer with its
 * explanation and references. A finished run is saved as an attempt; the result screen gives
 * the score against last time, a short history, and a round of only the missed questions.
 */
export function QuizPlayer({ quiz, index, storageKey, workspaceId, studyId, lastAttempt }: Props) {
  const saved = useMemo(() => loadProgress(storageKey, quiz), [storageKey, quiz]);
  const [at, setAt] = useState(saved?.at ?? 0);
  const [answers, setAnswers] = useState<Record<string, number>>(saved?.answers ?? {});
  const [finished, setFinished] = useState(saved?.finished ?? false);
  const [only, setOnly] = useState(saved?.only);
  const [previous, setPrevious] = useState(saved?.previous);
  const [resumed] = useState(Boolean(saved) && !saved?.finished);
  useEffect(() => {
    const started = finished || at > 0 || Object.keys(answers).length > 0 || Boolean(only);
    saveProgress(storageKey, started ? { at, answers, finished, only, previous } : undefined);
  }, [storageKey, at, answers, finished, only, previous]);

  const record = useRecordAttempt(workspaceId, studyId);
  const keyboard = useBreakpoint() !== 'phone';

  // After "Next", a finished run or a new round, focus moves to the new heading so keyboard and
  // screen-reader users start there; otherwise it would stay on whichever button was pressed.
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const roundKey = only?.join(',') ?? '';
  useEffect(() => {
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [at, finished, roundKey]);

  const questions = useMemo(
    () => (only ? quiz.questions.filter((q) => only.includes(q.id)) : quiz.questions),
    [quiz, only],
  );
  const total = questions.length;
  const question = questions[at];
  const picked = question ? answers[question.id] : undefined;
  const answered = picked !== undefined;
  const last = at === total - 1;

  const pick = (choice: number) => {
    if (!question || answered || choice >= question.options.length) return;
    setAnswers((prev) => ({ ...prev, [question.id]: choice }));
  };
  const next = () => {
    if (!answered) return;
    if (!last) {
      setAt(at + 1);
      return;
    }
    setFinished(true);
    // A round of only the missed questions is practice: saving it would make the history
    // compare 2 of 3 with 6 of 8.
    if (only) return;
    setPrevious(lastAttempt);
    record.mutate({
      score: questions.filter((q) => answers[q.id] === q.answerIndex).length,
      total,
      items: quiz.questions.map((q, i) => ({ index: i, ok: answers[q.id] === q.answerIndex })),
    });
  };
  const startRound = (ids: string[] | undefined) => {
    setAnswers({});
    setAt(0);
    setOnly(ids);
    setFinished(false);
  };

  useShortcut(['1', '2', '3', '4', '5', '6'], (e) => pick(Number(e.key) - 1), {
    enabled: !finished,
  });
  useShortcut('enter', next, { enabled: !finished && answered });

  if (total === 0) return null;

  if (finished) {
    const right = questions.filter((q) => answers[q.id] === q.answerIndex).length;
    const missed = questions.filter((q) => answers[q.id] !== q.answerIndex).map((q) => q.id);
    const percent = Math.round((right / total) * 100);
    return (
      <div className="max-w-[640px]">
        <h3 ref={heading} tabIndex={-1} className="heading-display outline-none">
          {s.quiz.score(right, total)}{' '}
          <span className="font-sans text-base font-normal text-ink-3">{percent}%</span>
        </h3>
        <p className="mt-1 text-sm text-ink-3">
          {only ? s.quiz.missedRoundDone : right === total ? s.quiz.allRight : s.quiz.scoreLabel}
          {!only && previous && ` ${s.quiz.lastTime(previous.score, previous.total)}`}
        </p>
        {!only && <SaveState record={record} />}
        {!only && <RecentAttempts studyId={studyId} className="mt-5" />}

        <div className="mt-6 flex flex-wrap gap-2">
          {missed.length > 0 && (
            <Button variant="primary" onClick={() => startRound(missed)}>
              {s.quiz.goOverMissed(missed.length)}
            </Button>
          )}
          <Button variant="secondary" onClick={() => startRound(undefined)}>
            {only ? s.quiz.wholeAgain : s.quiz.again}
          </Button>
        </div>

        <section aria-labelledby="review" className="mt-10">
          <h3 id="review" className="heading-section">
            {only ? s.quiz.reviewRound : s.quiz.review}
          </h3>
          <ol className="mt-3 flex flex-col gap-5">
            {questions.map((q) => {
              const mine = answers[q.id];
              const correct = mine === q.answerIndex;
              return (
                <li key={q.id} className="flex gap-3">
                  <span
                    className={cn(
                      'w-6 shrink-0 pt-0.5 text-center font-serif text-lg leading-snug font-semibold',
                      correct ? 'text-ok' : 'text-error',
                    )}
                  >
                    <span aria-hidden>{correct ? '✓' : '✗'}</span>
                    <span className="sr-only">{correct ? s.quiz.correct : s.quiz.missed}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="font-serif text-base text-ink">
                      <span className="text-ink-3">{quiz.questions.indexOf(q) + 1}. </span>
                      {q.question}
                    </p>
                    {!correct && mine !== undefined && (
                      <p className="mt-1 text-sm text-ink-3">
                        {s.quiz.yourAnswer}: {q.options[mine]}
                      </p>
                    )}
                    <p className="mt-0.5 text-sm text-ink">
                      <span className="text-ink-3">{s.quiz.answer}: </span>
                      {q.options[q.answerIndex]}
                    </p>
                    <p className="mt-1.5 text-sm text-ink-2">
                      {q.explanation}{' '}
                      <Cites citations={citationsOf(q, index)} uncited={q.uncited} />
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="max-w-[640px]">
      {resumed && <p className="mb-2 text-xs text-ink-3">{s.quiz.resumed}</p>}
      {only && <p className="mb-2 text-xs text-ink-3">{s.quiz.missedRound(total)}</p>}
      <p className="flex items-baseline justify-between text-xs text-ink-3">
        <span>{s.quiz.of(at + 1, total)}</span>
        <span>{question.difficulty}</span>
      </p>
      <ProgressRule
        className="mt-2"
        label={s.quiz.of(at + 1, total)}
        value={(at + (answered ? 1 : 0)) / total}
      />
      <h3 ref={heading} tabIndex={-1} className="heading-section mt-4 font-medium outline-none">
        {question.question}
      </h3>

      <ol className="mt-5 border-t border-rule" aria-label={s.quiz.choices}>
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
                <span className="w-4 shrink-0 pt-px text-xs text-ink-3 tabular-nums">{i + 1}</span>
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
            {question.explanation}{' '}
            <Cites citations={citationsOf(question, index)} uncited={question.uncited} />
          </p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-4">
        {keyboard ? (
          <p className="text-xs text-ink-3">
            <Kbd>1</Kbd>–<Kbd>{Math.min(question.options.length, 6)}</Kbd> {s.quiz.keyAnswer} ·{' '}
            <Kbd>Enter</Kbd> {s.quiz.keyNext}
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

/** Says so when the score couldn't be kept, with a way to try again; quiet otherwise. */
function SaveState({ record }: { record: ReturnType<typeof useRecordAttempt> }) {
  if (!record.isError || !record.variables) return null;
  const body: RecordAttemptBody = record.variables;
  return (
    <p role="alert" className="mt-2 text-xs text-ink-3">
      {s.quiz.notSaved}{' '}
      <TextButton className="inline-flex min-h-10 items-center" onClick={() => record.mutate(body)}>
        {s.retry}
      </TextButton>
    </p>
  );
}
