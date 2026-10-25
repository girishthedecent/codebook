import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import winston from 'winston';
import { resetDb } from './helpers/db.js';

// The checks from the security review (PLAN 17.1) that need a test of their own. The rest
// are covered next to the code they protect; docs/security.md lists where.

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
};
type Router = { stack: Layer[] };

// A router keeps no record of the path it mounted a sub-router at, so the paths are noted
// as the routers are built, by wrapping Router.use until the app has been imported.
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

const { createApp } = await import('../src/app.js');
const { v1Mounts } = await import('../src/routers/v1/index.router.js');
const { default: logger } = await import('../src/config/logger.config.js');
const { default: prismaClient } = await import('../src/config/db.config.js');
const { genericErrorHandler } = await import('../src/middlewares/error.middleware.js');
const { attachCorrelationIdMiddleware } =
  await import('../src/middlewares/correlation.middleware.js');
const events = await import('../src/inngest/events.js');
const { authAgent, ORIGIN, signUp } = await import('./helpers/auth.js');
RouterProto.use = originalUse;

type Route = { method: string; path: string };

function routesOf(router: Router, prefix: string): Route[] {
  return router.stack.flatMap((layer) => {
    if (layer.route) {
      const path = `${prefix}${layer.route.path}`.replace(/(.)\/$/, '$1');
      return Object.keys(layer.route.methods)
        .filter((method) => method !== '_all')
        .map((method) => ({ method, path }));
    }
    if (layer.handle.stack) {
      const mounted = mountPaths.get(layer) ?? '/';
      return routesOf(layer.handle as Router, mounted === '/' ? prefix : `${prefix}${mounted}`);
    }
    return [];
  });
}

// One entry per method and path: a path can have several routes (PDF vs JSON sources).
const v1Routes = [
  ...new Map(
    v1Mounts
      .flatMap(([prefix, router]) => routesOf(router as unknown as Router, `/api/v1${prefix}`))
      .map((route) => [`${route.method} ${route.path}`, route]),
  ).values(),
];

// Open without a session, by method and path: a new route here must be added on purpose.
const PUBLIC = new Set(['get /api/v1/health/live', 'get /api/v1/health/ready', 'get /api/v1/demo']);
// Admin routes answer like routes that don't exist, signed in or not.
const ADMIN = [/^\/api\/v1\/monitoring\//, /^\/api\/v1\/evals\//];

// Any id-shaped value: auth runs before the params are validated.
const fillParams = (path: string) => path.replace(/:\w+/g, 'cm0000000000000000000000a');

describe('route auth', () => {
  it('finds every mounted route, nested routers included', () => {
    const paths = v1Routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'get /api/v1/me',
        'post /api/v1/workspaces/:workspaceId/sources',
        'get /api/v1/sources/:sourceId/graph/callers',
        'post /api/v1/conversations/:conversationId/messages',
        'get /api/v1/monitoring/stats',
      ]),
    );
    expect(v1Routes.length).toBeGreaterThan(40);
  });

  it('answers 401 without a session everywhere but the public and admin routes', async () => {
    const app = createApp();
    const wrong: string[] = [];
    for (const { method, path } of v1Routes) {
      const res = await request(app)[method as 'get'](fillParams(path)).send({});
      let ok: boolean;
      if (PUBLIC.has(`${method} ${path}`)) {
        ok = res.status !== 401 && res.status < 500;
      } else if (ADMIN.some((re) => re.test(path))) {
        // requireAdmin's own 404, not a handler's "not found" for the made-up id.
        ok = res.status === 404 && String(res.body.message).startsWith('Route not found:');
      } else {
        ok = res.status === 401;
      }
      if (!ok) wrong.push(`${method.toUpperCase()} ${path} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('logs', () => {
  const lines: string[] = [];
  const sink = new winston.transports.Stream({
    stream: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
  });
  let silent: boolean;
  let level: string;

  beforeAll(() => {
    silent = logger.silent;
    level = logger.level;
    logger.silent = false;
    logger.level = 'debug';
    // Only the sink: the console transport would print the test's traffic.
    for (const transport of logger.transports) transport.silent = true;
    logger.add(sink);
    sink.silent = false;
  });

  afterAll(() => {
    logger.remove(sink);
    for (const transport of logger.transports) transport.silent = false;
    logger.silent = silent;
    logger.level = level;
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('never contain the password, the session cookie or its token', async () => {
    const password = ['log', 'check', 'pass', 'word'].join('-');
    const agent = authAgent();
    const signedUp = await signUp(agent, 'logs@example.com', password);
    const cookie = String(signedUp.headers['set-cookie']).split(';')[0]!;
    const token = cookie.split('=')[1]!;
    const signIn = await authAgent()
      .post('/api/auth/sign-in/email')
      .set('origin', ORIGIN)
      .send({ email: 'logs@example.com', password: `${password}-wrong` });
    expect(signIn.status).toBe(401);
    await agent.get('/api/v1/me').expect(200);
    await agent.get('/api/v1/workspaces/not-an-id').expect(400);
    await request(createApp()).get('/api/v1/me').set('cookie', `${cookie}x`).expect(401);
    await agent.post('/api/auth/sign-out').set('origin', ORIGIN).send({}).expect(200);

    const output = lines.join('\n');
    expect(output).toContain('/api/v1/me');
    expect(output).not.toContain(password);
    expect(output).not.toContain(decodeURIComponent(token).split('.')[0]!);
    expect(output).not.toContain('session_token');
  });
});

describe('error bodies', () => {
  it('carry no stack trace or SQL, for database and unexpected errors alike', async () => {
    const dbError = await prismaClient
      .$queryRawUnsafe('SELECT secret_column FROM table_that_is_missing')
      .catch((error: unknown) => error);
    expect(dbError).toBeInstanceOf(Error);

    const app = express();
    app.use(attachCorrelationIdMiddleware);
    app.get('/db', () => {
      throw dbError;
    });
    app.get('/plain', () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    });
    app.use(genericErrorHandler);

    for (const path of ['/db', '/plain']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        message: 'Something went wrong',
        code: 'INTERNAL',
        correlationId: expect.any(String),
      });
      expect(res.text).not.toMatch(/SELECT|table_that_is_missing|ECONNREFUSED|hunter2|\bat /);
    }
  });
});

describe('Inngest events', () => {
  it('carry ids and settings only, never secrets or user text', () => {
    const fields = Object.values(events).flatMap((event) =>
      Object.keys((event.schema as { shape: Record<string, unknown> }).shape).map(
        (field) => `${event.name}.${field}`,
      ),
    );
    expect(fields.length).toBeGreaterThan(10);
    const risky = fields.filter((field) =>
      /secret|token|password|cookie|key|content|text|question|url|email/i.test(
        field.split('.').pop()!,
      ),
    );
    expect(risky).toEqual([]);
  });
});

describe('in production', () => {
  // A full production environment with placeholder values; the database stays the test one.
  const productionEnv = {
    NODE_ENV: 'production',
    INNGEST_DEV: '',
    BETTER_AUTH_URL: 'https://api.example.com',
    TRUSTED_ORIGINS: 'https://app.example.com',
    GROQ_API_KEY: ['groq', 'placeholder'].join('-'),
    GEMINI_API_KEY: ['gemini', 'placeholder'].join('-'),
    S3_ENDPOINT: 'https://s3.example.com',
    S3_BUCKET: 'codebook',
    S3_ACCESS_KEY: ['access', 'placeholder'].join('-'),
    S3_SECRET_KEY: ['secret', 'placeholder'].join('-'),
    INNGEST_EVENT_KEY: ['event', 'placeholder'].join('-'),
    INNGEST_SIGNING_KEY: `signkey-prod-${'ab'.repeat(32)}`,
  };

  let prodApp: express.Express;
  let prodPrisma: { $disconnect(): Promise<void> };

  beforeAll(async () => {
    await resetDb();
    for (const [name, value] of Object.entries(productionEnv)) vi.stubEnv(name, value);
    vi.resetModules();
    prodApp = (await import('../src/app.js')).createApp();
    prodPrisma = (await import('../src/config/db.config.js')).default;
  });

  afterAll(async () => {
    await prodPrisma.$disconnect();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets the session cookie Secure, with the __Secure- prefix', async () => {
    const res = await request(prodApp)
      .post('/api/auth/sign-up/email')
      .set('origin', 'https://api.example.com')
      .send({ email: 'prod@example.com', password: 'correct-horse-battery', name: 'Prod' });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/__Secure-better-auth\.session_token=/);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('refuses unsigned calls to the Inngest endpoint', async () => {
    const res = await request(prodApp)
      .post('/api/inngest?fnId=codebook-ingest-source&stepId=step')
      .send({ event: { name: 'source/ingest.requested', data: { sourceId: 'x' } } });
    expect(res.status).toBe(401);
  });

  it('sends the security headers', async () => {
    const res = await request(prodApp).get('/api/v1/health/live');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
