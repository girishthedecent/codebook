import type { z } from 'zod';
import type { Workspace } from '../../generated/prisma/client.js';
import type {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  workspaceParamsSchema,
  workspaceSettingsSchema,
} from './workspace.validator.js';

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;

export type WorkspaceResponse = {
  id: string;
  name: string;
  description: string | null;
  template: Workspace['template'];
  isDemo: boolean;
  settings: WorkspaceSettings;
  createdAt: Date;
  updatedAt: Date;
};

// Picked field by field so columns added later don't end up in responses by accident.
export function toWorkspaceResponse(workspace: Workspace): WorkspaceResponse {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    template: workspace.template,
    isDemo: workspace.isDemo,
    settings: workspace.settings as WorkspaceSettings,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}
