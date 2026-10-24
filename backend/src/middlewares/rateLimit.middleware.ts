import type { NextFunction, Request, Response } from 'express';
import { TooManyRequestsError } from '../utils/errors/app.error.js';
import { consume, type LimitName } from '../utils/rateLimit.js';
import type { AuthSession } from '../config/auth.config.js';
import { getAuthUser } from './auth.middleware.js';

// What a limit is counted against; null means this request isn't limited by it.
export type LimitKey = (req: Request, res: Response) => string | null;

/**
 * The signed-in user, or the client IP for guests: a guest can make a new account at any
 * time, so counting per account would let them start over.
 */
export const perUser: LimitKey = (req, res) => userLimitKey(req, getAuthUser(res));

/** perUser's key for a user already in hand, for reading what is left of a limit. */
export function userLimitKey(req: Request, user: AuthSession['user']) {
  return user.isGuest ? `ip:${req.ip ?? 'unknown'}` : `user:${user.id}`;
}

export const perIp: LimitKey = (req) => `ip:${req.ip ?? 'unknown'}`;

/** Guests only, by IP; signed-up users pass. */
export const perGuestIp: LimitKey = (req, res) =>
  getAuthUser(res).isGuest ? `ip:${req.ip ?? 'unknown'}` : null;

/** Rejects the request with a 429 once `name`'s window is used up (the error handler adds Retry-After). */
export function limit(name: LimitName, keyOf: LimitKey = perUser) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = keyOf(req, res);
    if (key === null) return next();
    const { allowed, retryAfterSec } = await consume(name, key);
    next(allowed ? undefined : new TooManyRequestsError(retryAfterSec));
  };
}
