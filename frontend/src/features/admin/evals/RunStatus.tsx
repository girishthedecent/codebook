import { cn } from '@/lib/cn';
import type { EvalRun } from '@/api/types';

/** Run status as plain text: failures in the error color, running with a small accent dot. */
export function RunStatus({ status }: { status: EvalRun['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        status === 'FAILED' ? 'text-error' : status === 'RUNNING' ? 'text-ink' : 'text-ink-3',
      )}
    >
      {status === 'RUNNING' && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
      {status === 'DONE' ? 'done' : status === 'RUNNING' ? 'running' : 'failed'}
    </span>
  );
}
