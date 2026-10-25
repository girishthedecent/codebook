import SwaggerParser from '@apidevtools/swagger-parser';
import express from 'express';
import { describe, expect, it } from 'vitest';

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
};
type Router = { stack: Layer[] };

// A router keeps no record of the path it mounted a sub-router at, so the paths are noted
// as the routers are built, by wrapping Router.use until the app has been imported. A
// remounted router is then walked at its real path, whatever the docs say.
const mountPaths = new WeakMap<Layer, string>();
const RouterProto = express.Router.prototype as unknown as {
  use: (this: Router, ...args: unknown[]) => unknown;
};
const originalUse = RouterProto.use;
RouterProto.use = function use(this: Router, ...args: unknown[]) {
  const before = this.stack.length;
  const result = originalUse.apply(this, args);
  const path = typeof args[0] === 'string' ? args[0] : '/';
  for (const layer of this.stack.slice(before)) mountPaths.set(layer, path);
  return result;
};

const { API, openApiDocument } = await import('../src/openapi/registry.js');
const { v1Mounts } = await import('../src/routers/v1/index.router.js');
const { testApp } = await import('./helpers/app.js');
RouterProto.use = originalUse;

function join(prefix: string, path: string) {
  return path === '/' ? prefix : `${prefix}${path}`;
}

/** "METHOD /path" for every route of the router and the routers under it. */
function routesOf(router: Router, prefix: string): string[] {
  return router.stack.flatMap((layer) => {
    if (layer.route) {
      const path = join(prefix, layer.route.path);
      return Object.keys(layer.route.methods)
        .filter((method) => method !== '_all')
        .map((method) => `${method.toUpperCase()} ${path}`);
    }
    if (layer.handle.stack) {
      const mounted = mountPaths.get(layer);
      if (mounted === undefined) throw new Error(`A router under ${prefix} has no mount path`);
      return routesOf(layer.handle as Router, join(prefix, mounted));
    }
    return [];
  });
}

// A path can have two routes for one method (PDF uploads and JSON sources), hence the Set.
const mountedRoutes = () => [
  ...new Set(
    v1Mounts
      .flatMap(([prefix, router]) => routesOf(router as unknown as Router, `${API}${prefix}`))
      .map((route) => route.replace(/:(\w+)/g, '{$1}')),
  ),
];

function documentedRoutes() {
  const paths = openApiDocument().paths ?? {};
  return Object.entries(paths).flatMap(([path, item]) =>
    Object.keys(item ?? {})
      .filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key))
      .map((method) => `${method.toUpperCase()} ${path}`),
  );
}

describe('OpenAPI document', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    // validate() resolves $refs in place.
    const document = structuredClone(openApiDocument());
    await expect(SwaggerParser.validate(document as never)).resolves.toBeTruthy();
    expect(openApiDocument().openapi).toBe('3.1.0');
  });

  it('documents every mounted /api/v1 route, and only those', () => {
    const mounted = mountedRoutes();
    const documented = documentedRoutes().filter((route) => route.includes(` ${API}/`));

    expect(mounted.length).toBeGreaterThan(40);
    // Routes of nested routers, at the paths they are really mounted on.
    expect(mounted).toEqual(
      expect.arrayContaining([
        `POST ${API}/workspaces/{workspaceId}/sources`,
        `GET ${API}/workspaces/{workspaceId}/conversations`,
        `POST ${API}/workspaces/{workspaceId}/study`,
        `GET ${API}/sources/{sourceId}/graph/callers`,
      ]),
    );
    expect(mounted.filter((route) => !documented.includes(route))).toEqual([]);
    expect(documented.filter((route) => !mounted.includes(route))).toEqual([]);
  });

  it('documents the event streams with their events', () => {
    const paths = openApiDocument().paths!;
    const turn = paths[`${API}/conversations/{conversationId}/messages`]!.post!;
    const events = paths[`${API}/sources/{sourceId}/events`]!.get!;
    expect(Object.keys(turn.responses!['200'].content)).toEqual(['text/event-stream']);
    expect(Object.keys(events.responses!['200'].content)).toEqual(['text/event-stream']);

    const schemas = openApiDocument().components!.schemas!;
    const names = (id: string) =>
      (schemas[id] as { oneOf?: { properties: { event: { enum: string[] } } }[] }).oneOf!.map(
        (event) => event.properties.event.enum[0],
      );
    expect(names('TurnEvents')).toEqual(['step', 'token', 'citations', 'done', 'error']);
    expect(names('SourceEvents')).toEqual(['progress', 'done', 'failed', 'deleted', 'error']);
  });

  it('marks public and admin routes', () => {
    const paths = openApiDocument().paths!;
    expect(paths[`${API}/demo`]!.get!.security).toEqual([]);
    expect(paths[`${API}/health/live`]!.get!.security).toEqual([]);
    expect(paths['/api/auth/sign-in/anonymous']!.post!.security).toEqual([]);
    // Signed-in routes use the document's default, the session cookie.
    expect(paths[`${API}/workspaces`]!.get!.security).toBeUndefined();
    expect(openApiDocument().security).toEqual([{ session: [] }]);

    const admin = Object.entries(paths).flatMap(([path, item]) =>
      Object.values(item ?? {}).some((op) => (op as { tags?: string[] }).tags?.includes('admin'))
        ? [path]
        : [],
    );
    expect(admin.length).toBeGreaterThan(0);
    expect(admin.every((path) => /\/(evals|monitoring)\//.test(path))).toBe(true);
  });
});

describe('GET /openapi.json', () => {
  it('serves the document', async () => {
    const res = await testApp().get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/json');
    expect(res.body.info.title).toBe('CodeBook API');
    expect(Object.keys(res.body.paths)).toContain(`${API}/demo`);
  });
});

describe('/docs', () => {
  it('redirects to the trailing slash its relative asset paths need', async () => {
    const res = await testApp().get('/docs');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/docs/');
  });

  it('serves Swagger UI from the package, pointed at /openapi.json', async () => {
    const page = await testApp().get('/docs/');
    expect(page.status).toBe(200);
    expect(page.type).toBe('text/html');
    expect(page.text).toContain('swagger-ui-bundle.js');
    expect(page.text).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);

    const csp = page.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');

    // Everything the page links to, which is all the allowlist lets through.
    const linked = [...page.text.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map((m) => m[1]);
    expect(linked).toEqual(
      expect.arrayContaining([
        'swagger-ui.css',
        'swagger-ui-bundle.js',
        'swagger-ui-standalone-preset.js',
        'swagger-ui-init.js',
      ]),
    );
    for (const file of linked) {
      const asset = await testApp().get(`/docs/${file}`);
      expect(asset.status, file).toBe(200);
    }
    const init = await testApp().get('/docs/swagger-ui-init.js');
    expect(init.status).toBe(200);
    expect(init.text).toContain('"/openapi.json"');
    expect(init.text).toContain('"validatorUrl": null');
  });

  it("doesn't serve the rest of the package's files", async () => {
    for (const file of [
      'package.json',
      'package%2ejson',
      'index.html',
      'swagger-initializer.js',
      'oauth2-redirect.html',
      'swagger-ui-bundle.js.map',
      'swagger-ui.js',
    ]) {
      const res = await testApp().get(`/docs/${file}`);
      expect(res.status, file).toBe(404);
      expect(res.body.code, file).toBe('NOT_FOUND');
    }
  });
});
