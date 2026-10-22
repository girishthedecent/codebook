import { z } from 'zod';
import { WorkspaceTemplate } from '../../generated/prisma/enums.js';
import { paginationQuerySchema } from '../../utils/helpers/pagination.helpers.js';

export const AGENT_TOOLS = [
  'search_sources',
  'search_code',
  'list_files',
  'read_source',
  'browse_toc',
  'find_callers',
  'find_dependencies',
  'trace_flow',
  'web_search',
] as const;

export const SEARCH_MODES = ['vector', 'keyword', 'hybrid'] as const;

// Strict, so a typo in a key is a 400 instead of a setting that silently does nothing.
export const workspaceSettingsSchema = z.strictObject({
  defaultSearchMode: z.enum(SEARCH_MODES).optional(),
  studyToolsEnabled: z.boolean().optional(),
  preferredTools: z
    .array(z.enum(AGENT_TOOLS))
    .max(AGENT_TOOLS.length)
    .transform((tools) => [...new Set(tools)])
    .optional(),
});

const name = z.string().trim().min(1).max(80);
// An empty description is stored as no description.
const description = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || null);

export const createWorkspaceSchema = z.object({
  name,
  description: description.optional(),
  template: z.enum(WorkspaceTemplate).default(WorkspaceTemplate.BLANK),
});

export const updateWorkspaceSchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
    settings: workspaceSettingsSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nothing to update',
  });

export const workspaceParamsSchema = z.object({
  workspaceId: z.cuid(),
});

export const listWorkspacesQuerySchema = paginationQuerySchema;
