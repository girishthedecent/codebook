import type { NextFunction, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth, type AuthSession } from '../config/auth.config.js';
import { UnauthorizedError } from '../utils/errors/app.error.js';

async function loadSession(req: Request, res: Response) {
  const { headers, response: result } = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
    returnHeaders: true,
  });

  // When the session gets extended (updateAge), better-auth sends a refreshed cookie; pass it on
  // so active users aren't signed out when the original cookie expires.
  const setCookie = headers.getSetCookie();
  if (setCookie.length > 0) res.append('set-cookie', setCookie);

  if (result) {
    res.locals.user = result.user;
    res.locals.session = result.session;
  }
  return result;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(await loadSession(req, res))) throw new UnauthorizedError();
  next();
}

/** Loads the session when there is one, but lets anonymous requests through. */
export async function attachOptionalAuth(req: Request, res: Response, next: NextFunction) {
  await loadSession(req, res);
  next();
}

/** The signed-in user. Only call this behind `requireAuth`. */
export function getAuthUser(res: Response): AuthSession['user'] {
  const { user } = res.locals;
  if (!user) throw new UnauthorizedError();
  return user;
}
