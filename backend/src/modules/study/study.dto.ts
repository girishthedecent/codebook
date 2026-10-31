import type { z } from 'zod';
import type { StudyArtifact } from '../../generated/prisma/client.js';
import type { CitationRef } from '../citations/citations.types.js';
import { errorCodeOf, type StudyErrorCode } from './study.errors.js';
import type {
  createStudySchema,
  listStudyQuerySchema,
  studyParamsSchema,
} from './study.validator.js';

export type CreateStudyInput = z.infer<typeof createStudySchema>;
export type ListStudyQuery = z.infer<typeof listStudyQuerySchema>;
export type StudyParams = z.infer<typeof studyParamsSchema>;

// What generation needs again on a regenerate, as stored in StudyArtifact.input.
export type StudyInput = Omit<CreateStudyInput, 'type'>;

type ResolvedSource = Omit<CitationRef, 'text'> & { snippet: string };

export type StudyResponse = {
  id: string;
  workspaceId: string;
  type: StudyArtifact['type'];
  title: string;
  status: StudyArtifact['status'];
  input: StudyInput;
  // A failed set: the reason in words, and as a code (a cancelled set has `CANCELLED`).
  error: string | null;
  errorCode: StudyErrorCode | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Only on GET /study/:id: the items, and what each citation number points at.
  data?: unknown;
  sources?: ResolvedSource[];
};

const SNIPPET_CHARS = 300;

export function toStudyResponse(artifact: StudyArtifact, { full = false } = {}): StudyResponse {
  const response: StudyResponse = {
    id: artifact.id,
    workspaceId: artifact.workspaceId,
    type: artifact.type,
    title: artifact.title,
    status: artifact.status,
    input: artifact.input as StudyInput,
    error: artifact.error,
    errorCode: errorCodeOf(artifact),
    model: artifact.model,
    promptVersion: artifact.promptVersion,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
  if (!full) return response;

  const sources = (artifact.sources as CitationRef[]).map(({ text, ...ref }) => ({
    ...ref,
    snippet: text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text,
  }));
  return { ...response, data: artifact.data, sources };
}
