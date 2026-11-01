import { useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { Button, ProgressRule, StatusDot } from '@/ui';
import { cn } from '@/lib/cn';
import { chat } from './strings';
import { formatMs, stepDetail, stepPast, stepRunning, stepSummary } from './toolLabels';
import type { StepView } from './useTurn';

function StepRow({ step }: { step: StepView }) {
  const detail = stepDetail(step.tool, step.args);
  const summary = stepSummary(step.summary);
  const state = step.running ? chat.stepRunning : step.ok ? chat.stepDone : chat.stepFailed;
  return (
    <li className="flex items-baseline gap-2.5 text-xs">
      <StatusDot
        hideLabel
        label={state}
        tone={step.running ? 'accent' : step.ok ? 'ok' : 'error'}
        className={cn('translate-y-px', step.running && 'animate-pulse motion-reduce:animate-none')}
      />
      <span className={cn('min-w-0 flex-1', step.running ? 'text-ink' : 'text-ink-2')}>
        {step.running ? stepRunning(step.tool) : stepPast(step.tool)}
        {detail && <span className="text-ink-3"> {detail}</span>}
        {!step.running && (summary || !step.ok) && (
          <span className={step.ok ? 'text-ink-3' : 'text-error'}>
            {' '}
            · {step.ok ? summary : summary ? `${chat.stepFailed}: ${summary}` : chat.stepFailed}
          </span>
        )}
      </span>
      {step.ms !== undefined && !step.running && (
        <span className="shrink-0 text-ink-3 tabular-nums">{formatMs(step.ms)}</span>
      )}
    </li>
  );
}

/** What the agent is doing right now, one row per call, while a turn runs. */
export function LiveSteps({ steps }: { steps: StepView[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mt-4 space-y-1.5" aria-label={chat.stepsLabel}>
      {steps.map((s) => (
        <StepRow key={s.id} step={s} />
      ))}
    </ol>
  );
}

/**
 * The colophon after an answer: what was consulted, each step in the words its tool reported.
 * One line until it is opened, then the list with timings.
 */
export function Consulted({
  steps,
  totalMs,
  weak,
}: {
  steps: StepView[];
  totalMs?: number;
  weak?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0 && !weak) return null;

  const line = steps
    .map((s) => (s.ok ? stepSummary(s.summary) || stepPast(s.tool) : chat.stepFailed))
    .join('; ');
  const total = totalMs ?? steps.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  return (
    <div className="mt-5 text-xs text-ink-3">
      {steps.length > 0 && (
        <>
          <Button
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="-ml-2.5 max-w-full justify-start gap-1.5"
          >
            <CaretRight
              size={10}
              weight="bold"
              aria-hidden
              className={cn('shrink-0 transition-transform duration-150', open && 'rotate-90')}
            />
            <span className="small-caps shrink-0 font-serif text-sm">{chat.consulted}</span>
            {!open && <span className="min-w-0 truncate">{line}</span>}
            {total > 0 && <span className="shrink-0 tabular-nums">{formatMs(total)}</span>}
          </Button>
          {open && (
            <ol className="mt-1 space-y-1.5" aria-label={chat.stepsLabel}>
              {steps.map((s) => (
                <StepRow key={s.id} step={s} />
              ))}
            </ol>
          )}
        </>
      )}
      {weak && <p className="mt-2 font-serif text-sm text-ink-2 italic">{chat.weakRetrieval}</p>}
    </div>
  );
}

/**
 * The one quiet line while a turn is working: what it is doing now. Once the agent has started
 * working the label never goes back to "Starting" between its steps.
 */
export function TurnStatusLine({ steps, writing }: { steps: StepView[]; writing: boolean }) {
  const current = [...steps].reverse().find((s) => s.running);
  const label = current
    ? stepRunning(current.tool)
    : writing
      ? chat.writing
      : steps.length > 0
        ? chat.thinking
        : chat.starting;
  return (
    <div className="mt-3" aria-live="polite">
      <p className="text-xs text-ink-3">{label}</p>
      <ProgressRule label={label} className="mt-1.5 max-w-[240px]" />
    </div>
  );
}
