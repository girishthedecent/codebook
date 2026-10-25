import { useState } from 'react';
import { ProgressRule } from '@/ui';
import { cn } from '@/lib/cn';
import { chat } from './strings';
import { formatMs, stepDetail, stepRunning, stepVerb } from './toolLabels';
import type { StepView } from './useTurn';

/**
 * What the agent did, as working notes in mono under the question. While the turn runs the
 * list is open; when it ends it folds to one line ("4 steps · 3.1 s") that opens again.
 */
export function Steps({
  steps,
  live,
  totalMs,
}: {
  steps: StepView[];
  live: boolean;
  totalMs?: number;
}) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const total = totalMs ?? steps.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  const expanded = live || open;

  return (
    <div className="mt-2 font-mono text-xs text-ink-3">
      {!live && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="-mx-1 rounded-xs px-1 py-0.5 hover:bg-paper-2 hover:text-ink-2"
        >
          {chat.steps(steps.length)}
          {total > 0 && ` · ${formatMs(total)}`}
        </button>
      )}
      {expanded && (
        <ol className={cn('space-y-0.5 border-l border-rule pl-3', !live && 'mt-1')}>
          {steps.map((s) => (
            <StepRow key={`${s.index}:${s.tool}`} step={s} />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({ step }: { step: StepView }) {
  const detail = stepDetail(step.tool, step.args);
  return (
    <li className={cn('flex gap-3', step.running && 'text-ink-2', !step.ok && 'text-error')}>
      <span className="shrink-0">{stepVerb(step.tool)}</span>
      {detail && <span className="min-w-0 truncate">{detail}</span>}
      {step.ms !== undefined && !step.running && (
        <span className="ml-auto shrink-0 tabular-nums">{formatMs(step.ms)}</span>
      )}
    </li>
  );
}

/** The single quiet line while a turn is working: what it is doing now, and a 1px rule. */
export function TurnStatusLine({ steps, writing }: { steps: StepView[]; writing: boolean }) {
  const current = [...steps].reverse().find((s) => s.running);
  const label = current ? stepRunning(current.tool) : writing ? chat.writing : chat.starting;
  return (
    <div className="mt-3" aria-live="polite">
      <p className="font-mono text-xs text-ink-3">{label}</p>
      <ProgressRule label={label} className="mt-1.5 max-w-[240px]" />
    </div>
  );
}
