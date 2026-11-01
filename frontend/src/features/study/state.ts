import type { Study } from '@/api/types';
import { errorCopy, statusLabel } from './strings';

// The server treats a set that has been pending this long as stuck and lets it be made again.
const STALE_MS = 15 * 60_000;

type Tone = 'neutral' | 'accent' | 'error';

export type StudyState = {
  /** Queued or running. */
  making: boolean;
  /** Stopped by its owner: not a failure. */
  cancelled: boolean;
  failed: boolean;
  tone?: Tone;
  label: string;
  /** Why it failed, in plain words. */
  reason?: string;
};

type Stateful = Pick<Study, 'status' | 'error' | 'errorCode'>;

export function studyState(study: Stateful): StudyState {
  switch (study.status) {
    case 'PENDING':
      return {
        making: true,
        cancelled: false,
        failed: false,
        tone: 'neutral',
        label: statusLabel.PENDING,
      };
    case 'RUNNING':
      return {
        making: true,
        cancelled: false,
        failed: false,
        tone: 'accent',
        label: statusLabel.RUNNING,
      };
    case 'DONE':
      return { making: false, cancelled: false, failed: false, label: statusLabel.DONE };
    case 'FAILED': {
      // Sets stopped before the code existed carry only the message.
      const cancelled = study.errorCode === 'CANCELLED' || study.error === 'Cancelled.';
      if (cancelled) {
        return {
          making: false,
          cancelled,
          failed: false,
          tone: 'neutral',
          label: statusLabel.CANCELLED,
        };
      }
      const copy = study.errorCode ? errorCopy[study.errorCode] : undefined;
      return {
        making: false,
        cancelled,
        failed: true,
        tone: 'error',
        label: statusLabel.FAILED,
        reason: copy ?? study.error ?? errorCopy.GENERATION_FAILED,
      };
    }
  }
}

/** Still pending long after it should have finished: stop waiting and say so. */
export function isStale(study: Pick<Study, 'status' | 'updatedAt'>, now = Date.now()) {
  const pending = study.status === 'PENDING' || study.status === 'RUNNING';
  return pending && now - new Date(study.updatedAt).getTime() > STALE_MS;
}
