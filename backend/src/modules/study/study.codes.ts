// Why a study set failed. Stored with the set, so a client can tell a set the owner stopped
// from one the models couldn't make, and word each its own way. Kept free of imports so the
// API schema can use it without loading the server.
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
