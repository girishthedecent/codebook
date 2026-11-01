import { appConfig } from '../../config/app.config.js';
import { ConflictError, NotFoundError } from '../../utils/errors/app.error.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';
import type {
  CreateHighlightInput,
  ListHighlightsQuery,
  UpdateHighlightInput,
} from './highlight.dto.js';
import {
  createHighlight,
  deleteHighlight,
  listHighlights,
  sourceInWorkspace,
  updateHighlightNote,
} from './highlight.repository.js';

// Highlights are private to the user who makes them. Anyone who may read the workspace may
// list theirs (on the demo that is an empty list); only the owner can make them.
export async function listHighlightsService(
  userId: string,
  workspaceId: string,
  { sourceId, ...page }: ListHighlightsQuery,
) {
  await assertWorkspaceAccess(userId, workspaceId, { allowDemoRead: true });
  return listHighlights(userId, workspaceId, sourceId, page);
}

export async function createHighlightService(
  userId: string,
  workspaceId: string,
  input: CreateHighlightInput,
) {
  await assertWorkspaceAccess(userId, workspaceId);
  if (!(await sourceInWorkspace(workspaceId, input.sourceId))) {
    throw new NotFoundError('Source not found');
  }

  const { maxPerWorkspace } = appConfig.highlights;
  const highlight = await createHighlight(
    {
      workspaceId,
      userId,
      sourceId: input.sourceId,
      page: input.page ?? null,
      path: input.path ?? null,
      lineStart: input.lineStart ?? null,
      lineEnd: input.lineEnd ?? null,
      heading: input.heading ?? null,
      text: input.text,
      note: input.note ?? null,
    },
    maxPerWorkspace,
  );
  if (!highlight) {
    throw new ConflictError(
      `You can keep up to ${maxPerWorkspace} highlights in a workspace. Delete some to add more.`,
      undefined,
      'HIGHLIGHT_LIMIT',
    );
  }
  return highlight;
}

export async function updateHighlightService(
  userId: string,
  highlightId: string,
  input: UpdateHighlightInput,
) {
  const highlight = await updateHighlightNote(userId, highlightId, input.note);
  if (!highlight) throw new NotFoundError('Highlight not found');
  return highlight;
}

export async function deleteHighlightService(userId: string, highlightId: string) {
  if (!(await deleteHighlight(userId, highlightId))) {
    throw new NotFoundError('Highlight not found');
  }
}
