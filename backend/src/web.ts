import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';

// The built web app (frontend/dist, copied here by `pnpm build:web`), served by the API itself:
// one origin, so the session cookie stays first-party, and event streams reach the browser
// as they are written (a proxy in front of the API held them back until the end). Absent in
// development, where Vite serves the app.
const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

// Paths that belong to the API; a request for one of them that matched nothing is a 404, not
// a page of the app.
const API_PATH = /^\/(api|docs)(\/|$)|^\/openapi\.json$/;

/** `'sha256-…'` source for each inline script of the page: the only ones its policy allows. */
function inlineScriptHashes(html: string) {
  const scripts = html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g);
  return [...scripts].map(
    ([, body]) => `'sha256-${createHash('sha256').update(body!).digest('base64')}'`,
  );
}

// Helmet's default policy for the page, with the hashes of its inline scripts (the theme
// before first paint, the preload list). Minus upgrade-insecure-requests, as for the docs
// page: it would send the page's own files to https on a plain-http host.
function pagePolicy(scriptHashes: string[]) {
  const directives = {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    'script-src': ["'self'", ...scriptHashes],
  };
  delete (directives as Record<string, unknown>)['upgrade-insecure-requests'];
  return Object.entries(directives)
    .map(([name, values]) => [name, ...(values as string[])].join(' '))
    .join('; ');
}

/**
 * The web app's files and, for any other GET that isn't the API's, its index page (the app
 * routes its own paths). Null when there is no build to serve.
 */
export function webRouter(root: string = WEB_ROOT) {
  const indexFile = join(root, 'index.html');
  if (!existsSync(indexFile)) return null;

  const html = readFileSync(indexFile, 'utf8');
  const policy = pagePolicy(inlineScriptHashes(html));

  const router = express.Router();
  router.use(
    express.static(root, {
      index: false,
      setHeaders(res, path) {
        // Files under assets/ are named by their content hash, so they never change.
        if (path.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  router.get('*splat', (req, res, next) => {
    // A path with an extension is a file that isn't there, not a page.
    if (API_PATH.test(req.path) || extname(req.path) !== '') return next();
    res.set({ 'Content-Security-Policy': policy, 'Cache-Control': 'no-cache' }).type('html');
    res.send(html);
  });
  return router;
}
