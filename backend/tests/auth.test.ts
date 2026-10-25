import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import prismaClient from '../src/config/db.config.js';
import { testApp } from './helpers/app.js';
import { authAgent, ORIGIN, signUp } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

beforeEach(async () => {
  await resetDb();
});

describe('email sign-up / sign-in', () => {
  it('signs up, sets an httpOnly session cookie and returns the user on /me', async () => {
    const agent = authAgent();
    const res = await signUp(agent);

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('better-auth.session_token=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      success: true,
      data: {
        email: 'reader@example.com',
        name: 'Test Reader',
        image: null,
        isGuest: false,
        isAdmin: false,
      },
    });
    expect(Object.keys(me.body.data).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'image',
      'isAdmin',
      'isGuest',
      'name',
    ]);
  });

  it('ignores isGuest / isSystem sent in the sign-up body', async () => {
    const res = await authAgent().post('/api/auth/sign-up/email').set('origin', ORIGIN).send({
      email: 'sneaky@example.com',
      password: 'correct-horse-battery',
      name: 'Sneaky',
      isSystem: true,
      isGuest: true,
    });
    // better-auth drops fields marked `input: false`; the user is created with the defaults.
    expect(res.status).toBe(200);
    const user = await prismaClient.user.findUnique({ where: { email: 'sneaky@example.com' } });
    expect(user).toMatchObject({ isSystem: false, isGuest: false });
  });

  it('rejects a wrong password with 401', async () => {
    await signUp(authAgent());

    const res = await authAgent()
      .post('/api/auth/sign-in/email')
      .set('origin', ORIGIN)
      .send({ email: 'reader@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('signs in with the right password', async () => {
    await signUp(authAgent());

    const agent = authAgent();
    const res = await agent
      .post('/api/auth/sign-in/email')
      .set('origin', ORIGIN)
      .send({ email: 'reader@example.com', password: 'correct-horse-battery' });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(200);
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const res = await authAgent()
      .post('/api/auth/sign-up/email')
      .set('origin', ORIGIN)
      .send({ email: 'short@example.com', password: 'short', name: 'Short' });
    expect(res.status).toBe(400);
  });
});

describe('/api/auth request handling', () => {
  it('rejects bodies over the auth size limit with 413', async () => {
    const res = await authAgent()
      .post('/api/auth/sign-in/email')
      .set('origin', ORIGIN)
      .send({ email: 'big@example.com', password: 'x'.repeat(100 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects an oversized chunked body (no Content-Length) with 413', async () => {
    const server = createApp().listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            port,
            method: 'POST',
            path: '/api/auth/sign-in/email',
            headers: { 'content-type': 'application/json', origin: ORIGIN },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        // Node sends chunked encoding when no Content-Length is set.
        req.end('{"password":"' + 'x'.repeat(100 * 1024) + '"}');
      });
      expect(status).toBe(413);
    } finally {
      server.close();
    }
  });

  it('ignores a malformed Host / X-Forwarded-Proto instead of failing', async () => {
    const res = await authAgent()
      .get('/api/auth/get-session')
      .set('host', 'exa mple')
      .set('x-forwarded-proto', 'a b');
    expect(res.status).toBe(200);
  });

  it('rejects sign-up from an untrusted origin', async () => {
    const res = await authAgent()
      .post('/api/auth/sign-up/email')
      .set('origin', 'http://evil.test')
      .send({ email: 'csrf@example.com', password: 'correct-horse-battery', name: 'Csrf' });
    expect(res.status).toBe(403);
    expect(await prismaClient.user.count({ where: { email: 'csrf@example.com' } })).toBe(0);
  });
});

describe('client IP', () => {
  it('ignores a client-sent X-Forwarded-For when no proxy is trusted', async () => {
    await authAgent()
      .post('/api/auth/sign-up/email')
      .set('origin', ORIGIN)
      .set('x-forwarded-for', '6.6.6.6')
      .set('x-client-ip', '7.7.7.7')
      .send({ email: 'ip@example.com', password: 'correct-horse-battery', name: 'Ip' });

    const session = await prismaClient.session.findFirst({
      where: { user: { email: 'ip@example.com' } },
    });
    expect(session?.ipAddress).toBeTruthy();
    expect(session?.ipAddress).not.toMatch(/6\.6\.6\.6|7\.7\.7\.7/);
  });
});

describe('GET /api/v1/me', () => {
  it('returns 401 without a session', async () => {
    const res = await testApp().get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: 'UNAUTHENTICATED' });
  });

  it('sends a refreshed session cookie once the session is older than a day', async () => {
    const agent = authAgent();
    await signUp(agent);
    // Make the session look two days old (7-day lifetime, refreshed after 1 day).
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    await prismaClient.session.updateMany({ data: { expiresAt: new Date(Date.now() + fiveDays) } });

    const res = await agent.get('/api/v1/me');
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('better-auth.session_token=');

    const session = await prismaClient.session.findFirstOrThrow();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + fiveDays + 60_000);
  });

  it('returns 401 after sign-out', async () => {
    const agent = authAgent();
    await signUp(agent);

    const out = await agent.post('/api/auth/sign-out').set('origin', ORIGIN).send({});
    expect(out.status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(401);
  });
});
