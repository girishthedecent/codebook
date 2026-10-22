import request from 'supertest';
import { createApp } from '../../src/app.js';

// better-auth rejects auth POSTs from origins it doesn't trust (CSRF check, on in tests too).
export const ORIGIN = 'http://localhost:4000';

export function authAgent() {
  return request.agent(createApp());
}

export async function signUp(
  agent: ReturnType<typeof authAgent>,
  email = 'reader@example.com',
  password = 'correct-horse-battery',
) {
  const res = await agent
    .post('/api/auth/sign-up/email')
    .set('origin', ORIGIN)
    .send({ email, password, name: 'Test Reader' });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${res.text}`);
  return res;
}

/** A new user with a signed-in agent. */
export async function signedInUser(email = 'reader@example.com') {
  const agent = authAgent();
  const res = await signUp(agent, email);
  return { agent, userId: (res.body as { user: { id: string } }).user.id };
}
