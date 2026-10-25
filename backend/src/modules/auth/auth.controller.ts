import type { Request, Response } from 'express';
import { serverConfig } from '../../config/index.js';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';

// Fields are picked explicitly so nothing new on the user row leaks by accident.
export function getMeHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);

  res.json(
    successResponse('Current user', {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image ?? null,
      isGuest: user.isGuest === true,
      // Lets the web app show the eval and monitoring pages; the routes still check for themselves.
      isAdmin: serverConfig.ADMIN_USER_IDS.includes(user.id),
      createdAt: user.createdAt,
    }),
  );
}
