import { LlmTimeoutError } from '../../llm/retry.js';
import { UpstreamError } from '../../utils/errors/app.error.js';
import { isStudyErrorCode, type StudyErrorCode } from './study.codes.js';

export { STUDY_ERROR_CODES, isStudyErrorCode, type StudyErrorCode } from './study.codes.js';

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
