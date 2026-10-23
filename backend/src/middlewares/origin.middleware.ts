import type { NextFunction, Request, Response } from 'express';
import { serverConfig } from '../config/index.js';
import { ForbiddenError } from '../utils/errors/app.error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowed = new Set([new URL(serverConfig.APP_URL).origin, ...serverConfig.TRUSTED_ORIGINS]);

/**
 * CSRF guard for cookie-authenticated writes. A cross-site page can send a multipart form
 * without a CORS preflight and the browser attaches our session cookie (SameSite=Lax only
 * stops that for some requests), so writes from a browser must come from a trusted origin.
 * Requests without an Origin header (curl, server-to-server) carry no victim's cookies.
 */
export function requireTrustedOrigin(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get('origin');
  if (SAFE_METHODS.has(req.method) || !origin || allowed.has(origin)) return next();
  throw new ForbiddenError('Origin not allowed');
}
