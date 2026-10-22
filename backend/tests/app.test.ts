import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers/app.js';
import { resetDb } from './helpers/db.js';

// Pinned in tests/testEnv.ts.
const FRONTEND = 'http://localhost:3000';

describe('CORS', () => {
  it('lets the trusted frontend send credentialed requests', async () => {
    const res = await testApp()
      .options('/api/v1/workspaces')
      .set('origin', FRONTEND)
      .set('access-control-request-method', 'PATCH');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('gives other origins no CORS headers', async () => {
    const res = await testApp()
      .options('/api/v1/workspaces')
      .set('origin', 'https://evil.test')
      .set('access-control-request-method', 'PATCH');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  describe('better-auth', () => {
    beforeEach(async () => {
      await resetDb();
    });

    it('accepts sign-up from the trusted frontend and rejects other origins', async () => {
      const body = { email: 'web@example.com', password: 'correct-horse-battery', name: 'Web' };

      const trusted = await testApp()
        .post('/api/auth/sign-up/email')
        .set('origin', FRONTEND)
        .send(body);
      expect(trusted.status).toBe(200);

      const other = await testApp()
        .post('/api/auth/sign-up/email')
        .set('origin', 'https://evil.test')
        .send({ ...body, email: 'evil@example.com' });
      expect(other.status).toBe(403);
    });
  });
});

describe('JSON bodies', () => {
  it('returns 413 for a body over the limit', async () => {
    const res = await testApp()
      .post('/api/v1/workspaces')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await testApp()
      .post('/api/v1/workspaces')
      .set('content-type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Malformed JSON body' });
  });
});

it('answers unknown routes with a JSON 404', async () => {
  const res = await testApp().get('/api/v1/nope');
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({ success: false, code: 'NOT_FOUND' });
  expect(res.body.correlationId).toEqual(expect.any(String));
});
