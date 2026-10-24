import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { userLimitKey } from '../../middlewares/rateLimit.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import { myUsageService } from './usage.service.js';

export async function myUsageHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const usage = await myUsageService(user.id, userLimitKey(req, user));
  res.json(successResponse('Usage', usage));
}
