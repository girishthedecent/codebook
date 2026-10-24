import type { NextFunction, Request, Response } from 'express';
import { serverConfig } from '../config/index.js';
import { NotFoundError } from '../utils/errors/app.error.js';
import { attachOptionalAuth } from './auth.middleware.js';

/**
 * Admin-only routes look exactly like routes that don't exist to everyone else, signed in
 * or not: the same 404 the not-found handler gives.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await attachOptionalAuth(req, res, () => {});
  const userId = res.locals.user?.id;
  if (!userId || !serverConfig.ADMIN_USER_IDS.includes(userId)) {
    throw new NotFoundError(`Route not found: ${req.method} ${req.baseUrl}${req.path}`);
  }
  next();
}
