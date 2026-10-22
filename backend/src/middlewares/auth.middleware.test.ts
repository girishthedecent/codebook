import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { authAgent, signUp } from '../../tests/helpers/auth.js';
import { resetDb } from '../../tests/helpers/db.js';
import { attachOptionalAuth } from './auth.middleware.js';

const app = express();
app.get('/whoami', attachOptionalAuth, (_req, res) => {
  res.json({ email: res.locals.user?.email ?? null });
});

beforeEach(async () => {
  await resetDb();
});

describe('attachOptionalAuth', () => {
  it('lets anonymous requests through without a user', async () => {
    const res = await request(app).get('/whoami');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: null });
  });

  it('loads the user when a session cookie is sent', async () => {
    const signedUp = await signUp(authAgent());
    const cookie = String(signedUp.headers['set-cookie']).split(';')[0]!;

    const res = await request(app).get('/whoami').set('cookie', cookie);
    expect(res.body).toEqual({ email: 'reader@example.com' });
  });
});
