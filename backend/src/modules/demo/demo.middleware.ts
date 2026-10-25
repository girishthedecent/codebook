import type { NextFunction, Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { ForbiddenError } from '../../utils/errors/app.error.js';

/**
 * Guests only read the demo and chat in it. Routes that create things of their own
 * (workspaces, sources, study sets) refuse them before any other check.
 */
export function forbidGuests(message: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    next(getAuthUser(res).isGuest ? new ForbiddenError(message) : undefined);
  };
}
