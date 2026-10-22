import type { NextFunction, Request, Response } from 'express';
import { CLIENT_IP_HEADER } from '../config/auth.config.js';

/**
 * Puts the IP Express resolved (which honours TRUST_PROXY) into the header better-auth reads.
 * Runs on every request so a client-sent value can never reach better-auth on any path.
 */
export function attachClientIpMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (req.ip) req.headers[CLIENT_IP_HEADER] = req.ip;
  else delete req.headers[CLIENT_IP_HEADER];
  next();
}
