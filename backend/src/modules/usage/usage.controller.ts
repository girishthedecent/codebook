import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { userLimitKey } from '../../middlewares/rateLimit.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import { guestWindow, myUsageService } from './usage.service.js';

export async function myUsageHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const limitKey = userLimitKey(req, user);
  const [usage, guest] = await Promise.all([
    myUsageService(user.id, limitKey),
    user.isGuest ? guestWindow(limitKey) : null,
  ]);
  res.json(successResponse('Usage', { ...usage, guest }));
}
