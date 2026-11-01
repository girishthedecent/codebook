import { LlmTimeoutError } from '../../llm/retry.js';
import { UpstreamError } from '../../utils/errors/app.error.js';

// Why a study set failed. Stored with the set, so a client can tell a set the owner stopped
// from one the models couldn't make, and word each its own way.
export const STUDY_ERROR_CODES = [
  'CANCELLED',
  'VALIDATION_FAILED',
  'MODEL_UNAVAILABLE',
  'TIMEOUT',
  'NO_MATERIAL',
  'QUEUE_FAILED',
  'GENERATION_FAILED',
] as const;

export type StudyErrorCode = (typeof STUDY_ERROR_CODES)[number];

export const isStudyErrorCode = (value: unknown): value is StudyErrorCode =>
  STUDY_ERROR_CODES.some((code) => code === value);

// Shown with a set when nothing more specific is known. Safe for users: no provider details.
export const STUDY_ERROR_MESSAGES: Record<StudyErrorCode, string> = {
  CANCELLED: 'Cancelled.',
  VALIDATION_FAILED: "The generated set didn't pass checks. Try again.",
  MODEL_UNAVAILABLE: "The models couldn't answer right now. Try again in a few minutes.",
  TIMEOUT: 'The model took too long to answer. Try again in a few minutes.',
  NO_MATERIAL: 'There was nothing indexed to read for this selection.',
  QUEUE_FAILED: "Couldn't start generating. Try again in a moment.",
  GENERATION_FAILED: 'Generation failed. Try again in a few minutes.',
};

/** The code for an error thrown while generating: a slow model, a model that failed, or other. */
export function failureCode(error: unknown): StudyErrorCode {
  if (!(error instanceof UpstreamError)) return 'GENERATION_FAILED';
  return error.cause instanceof LlmTimeoutError ? 'TIMEOUT' : 'MODEL_UNAVAILABLE';
}

/** The code of a failed set: the stored one, or for sets stored without a code what their message says. */
export function errorCodeOf(set: {
  status: string;
  error: string | null;
  errorCode: string | null;
}) {
  if (set.status !== 'FAILED') return null;
  if (isStudyErrorCode(set.errorCode)) return set.errorCode;
  return set.error === STUDY_ERROR_MESSAGES.CANCELLED ? 'CANCELLED' : 'GENERATION_FAILED';
}
