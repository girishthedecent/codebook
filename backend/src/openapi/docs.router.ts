import express, { type NextFunction, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './registry.js';

// GET /openapi.json and the docs UI at /docs. Swagger UI's files are served from the
// package, so the page loads nothing from a CDN.

// Helmet's default policy for the rest of the app, minus upgrade-insecure-requests (it
// would send the page's own scripts to https on a plain-http host). Swagger UI needs
// inline styles and data: images; its scripts are all files served below.
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function docsHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set('Content-Security-Policy', DOCS_CSP);
  next();
}

// The page loads its files by relative paths (./swagger-ui.css), which only resolve under
// /docs/, so /docs itself redirects there.
function trailingSlash(req: Request, res: Response, next: NextFunction) {
  const [path, query] = req.originalUrl.split('?');
  if (path === '/docs') return res.redirect(301, `/docs/${query ? `?${query}` : ''}`);
  next();
}

// What the page loads. The package holds more (its own index.html, the OAuth redirect page,
// source maps, package.json); none of that is served.
const ASSETS = new Set([
  '/',
  '/swagger-ui.css',
  '/swagger-ui-bundle.js',
  '/swagger-ui-standalone-preset.js',
  '/swagger-ui-init.js',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
]);

// req.path is still %-encoded here, so an encoded name never matches and 404s too.
function onlyAssets(req: Request, _res: Response, next: NextFunction) {
  next(ASSETS.has(req.path) ? undefined : 'router');
}

export const docsRouter = express.Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument());
});

docsRouter.use(
  '/docs',
  docsHeaders,
  trailingSlash,
  onlyAssets,
  swaggerUi.serve,
  swaggerUi.setup(undefined, {
    customSiteTitle: 'CodeBook API',
    swaggerOptions: {
      url: '/openapi.json',
      // The default badge calls validator.swagger.io with the spec.
      validatorUrl: null,
      // Send the session cookie with "Try it out".
      withCredentials: true,
    },
  }),
);
