import type { WorkspaceTemplate } from '../../generated/prisma/enums.js';
import type { WorkspaceSettings } from './workspace.dto.js';

// Settings a new workspace starts with. The template itself is stored too, so chat can pick
// a matching system prompt.
export const templateSettings: Record<WorkspaceTemplate, WorkspaceSettings> = {
  STUDY: {
    defaultSearchMode: 'hybrid',
    studyToolsEnabled: true,
    preferredTools: ['browse_toc', 'search_sources'],
  },
  CODEBASE: {
    preferredTools: ['search_code', 'find_callers', 'trace_flow'],
  },
  BLANK: {},
};
