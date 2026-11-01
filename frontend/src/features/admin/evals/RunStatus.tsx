import type { EvalRun } from '@/api/types';
import { StatusDot } from '@/ui';

const looks = {
  DONE: { tone: 'ok', label: 'done' },
  RUNNING: { tone: 'accent', label: 'running' },
  FAILED: { tone: 'error', label: 'failed' },
} as const;

/** Run status as a small mark and a word. */
export function RunStatus({ status }: { status: EvalRun['status'] }) {
  const { tone, label } = looks[status];
  return <StatusDot tone={tone} label={label} />;
}
