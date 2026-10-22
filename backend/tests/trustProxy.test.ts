import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { createApp as CreateApp } from '../src/app.js';
import { ORIGIN } from './helpers/auth.js';

// The app reads TRUST_PROXY once at import time, so load a fresh copy with it turned on.
let createApp: typeof CreateApp;
let prismaClient: (typeof import('../src/config/db.config.js'))['default'];

beforeAll(async () => {
  process.env.TRUST_PROXY = 'loopback';
  vi.resetModules();
  ({ createApp } = await import('../src/app.js'));
  ({ default: prismaClient } = await import('../src/config/db.config.js'));
  const { resetDb } = await import('./helpers/db.js');
  await resetDb();
});

afterAll(async () => {
  process.env.TRUST_PROXY = 'false';
  await prismaClient.$disconnect();
});

describe('behind a trusted proxy', () => {
  it("records the client IP the proxy passed on, not the proxy's", async () => {
    const { default: request } = await import('supertest');
    const res = await request(createApp())
      .post('/api/auth/sign-up/email')
      .set('origin', ORIGIN)
      .set('x-forwarded-for', '203.0.113.7')
      .send({ email: 'proxied@example.com', password: 'correct-horse-battery', name: 'Proxied' });
    expect(res.status).toBe(200);

    const session = await prismaClient.session.findFirstOrThrow({
      where: { user: { email: 'proxied@example.com' } },
    });
    expect(session.ipAddress).toBe('203.0.113.7');
  });
});
