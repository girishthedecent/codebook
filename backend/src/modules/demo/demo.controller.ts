import type { Request, Response } from 'express';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import { toSourceResponse } from '../sources/source.dto.js';
import { toWorkspaceResponse } from '../workspaces/workspace.dto.js';
import { getDemoService } from './demo.service.js';

export async function getDemoHandler(_req: Request, res: Response) {
  const { workspace, sources } = await getDemoService();
  res.json(
    successResponse('Demo workspace', {
      workspace: toWorkspaceResponse(workspace),
      sources: sources.map(toSourceResponse),
    }),
  );
}
