import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webRouter } from './web.js';

const THEME = "try { document.documentElement.dataset.theme = 'dark'; } catch (e) {}";
const PRELOAD = '(function(){var deps=["/assets/app-1a2b3c.js"];})()';
const hash = (script: string) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`;

const INDEX = `<!doctype html>
<html><head>
<script>${THEME}</script>
<script type="module" crossorigin src="/assets/app-1a2b3c.js"></script>
<script>${PRELOAD}</script>
</head><body><div id="root"></div></body></html>`;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'codebook-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), INDEX);
  writeFileSync(join(root, 'assets', 'app-1a2b3c.js'), 'console.log(1)');
  writeFileSync(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(root, '.secret'), 'do not serve');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The web router in front of a stub API and a JSON 404, as in the real app. */
function appWithWeb() {
  const app = express();
  app.get('/api/v1/ping', (_req, res) => {
    res.json({ pong: true });
  });
  app.use(webRouter(root)!);
  app.use((_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND' });
  });
  return app;
}

describe('webRouter', () => {
  it('serves the index page at / and for any path the app routes itself', async () => {
    const app = appWithWeb();
    for (const path of ['/', '/w/abc/chat', '/sign-in']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.type).toBe('text/html');
      expect(res.text).toBe(INDEX);
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('allows the page its own scripts and exactly its inline ones', async () => {
    const res = await request(appWithWeb()).get('/');
    const policy = res.headers['content-security-policy']!;

    expect(policy).toContain(`script-src 'self' ${hash(THEME)} ${hash(PRELOAD)};`);
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain('upgrade-insecure-requests');
    expect(policy).not.toContain("'unsafe-inline'; script");
  });

  it('serves hashed files for a year and the rest revalidated', async () => {
    const app = appWithWeb();
    const asset = await request(app).get('/assets/app-1a2b3c.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const icon = await request(app).get('/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers['cache-control']).not.toMatch(/immutable/);
  });

  it('answers a missing file with a 404, not with the page', async () => {
    const res = await request(appWithWeb()).get('/assets/gone-9f9f9f.js');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND' });
  });

  it('leaves the API and its docs to the API', async () => {
    const app = appWithWeb();
    expect((await request(app).get('/api/v1/ping')).body).toEqual({ pong: true });
    for (const path of ['/api/v1/nothing', '/api/auth/x', '/docs/x', '/openapi.json']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.type, path).toBe('application/json');
    }
  });

  it('serves only GET and HEAD, and never a dotfile', async () => {
    const app = appWithWeb();
    expect((await request(app).post('/')).status).toBe(404);
    expect((await request(app).head('/w/abc')).status).toBe(200);
    const dotfile = await request(app).get('/.secret');
    expect(dotfile.text).not.toContain('do not serve');
  });

  it('is nothing at all when there is no build', () => {
    expect(webRouter(join(root, 'missing'))).toBeNull();
  });
});
