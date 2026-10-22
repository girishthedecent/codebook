import { getRequest, setResponse } from 'better-call/node';
import express, { type Request, type Response } from 'express';
import { appConfig } from '../config/app.config.js';
import { auth } from '../config/auth.config.js';
import { serverConfig } from '../config/index.js';

// better-auth's toNodeHandler() builds the URL from the client's Host / X-Forwarded-Proto and
// reads bodies of any size, so we build the request ourselves with a fixed base.
const base = new URL(serverConfig.BETTER_AUTH_URL).origin;

/**
 * Reads the body as text with a size limit before better-auth sees it, so an oversized body
 * gets a clean 413 whether or not it has a Content-Length. better-call passes a string body
 * through unchanged.
 */
export const readAuthBody = express.text({
  type: () => true,
  limit: appConfig.http.authBodyLimitBytes,
});

export async function authHandler(req: Request, res: Response) {
  const response = await auth.handler(getRequest({ request: req, base }));
  await setResponse(res, response);
}
