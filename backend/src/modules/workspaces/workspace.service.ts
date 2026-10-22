import { appConfig } from '../../config/app.config.js';
import { ConflictError, NotFoundError } from '../../utils/errors/app.error.js';
import type { PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from './workspace.dto.js';
import {
  createWorkspace,
  deleteWorkspace,
  findWorkspaceForUser,
  listWorkspaces,
  updateWorkspace,
} from './workspace.repository.js';
import { templateSettings } from './workspace.templates.js';

/**
 * The workspace, if this user may use it; otherwise a 404, whether it is missing or someone
 * else's. Other modules (sources, chat, study) call this before touching workspace data.
 * `allowDemoRead` also lets anyone read the public demo workspace.
 */
export async function assertWorkspaceAccess(
  userId: string,
  workspaceId: string,
  { allowDemoRead = false } = {},
) {
  const workspace = await findWorkspaceForUser(userId, workspaceId, {
    includeDemo: allowDemoRead,
  });
  if (!workspace) throw new NotFoundError('Workspace not found');
  return workspace;
}

export async function createWorkspaceService(userId: string, input: CreateWorkspaceInput) {
  const { maxPerUser } = appConfig.workspaces;
  const workspace = await createWorkspace(
    userId,
    { ...input, settings: templateSettings[input.template] },
    maxPerUser,
  );
  if (!workspace) {
    throw new ConflictError(
      `You can have up to ${maxPerUser} workspaces. Delete one to create another.`,
    );
  }
  return workspace;
}

export async function listWorkspacesService(userId: string, page: PaginationQuery) {
  return listWorkspaces(userId, page);
}

export async function getWorkspaceService(userId: string, workspaceId: string) {
  return assertWorkspaceAccess(userId, workspaceId);
}

export async function updateWorkspaceService(
  userId: string,
  workspaceId: string,
  input: UpdateWorkspaceInput,
) {
  const workspace = await updateWorkspace(userId, workspaceId, input);
  if (!workspace) throw new NotFoundError('Workspace not found');
  return workspace;
}

export async function deleteWorkspaceService(userId: string, workspaceId: string) {
  if (!(await deleteWorkspace(userId, workspaceId))) {
    throw new NotFoundError('Workspace not found');
  }
}
