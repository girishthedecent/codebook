import { APIError } from 'better-auth/api';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import logger from '../config/logger.config.js';
import { Prisma } from '../generated/prisma/client.js';
import { ConflictError, NotFoundError } from '../utils/errors/app.error.js';
import { attachCorrelationIdMiddleware } from './correlation.middleware.js';
import { genericErrorHandler, notFoundHandler } from './error.middleware.js';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });
}

function appThatThrows(err: unknown) {
  const app = express();
  app.use(attachCorrelationIdMiddleware);
  app.use(express.json({ limit: '10b' }));
  app.post('/boom', () => {
    throw err;
  });
  app.use(notFoundHandler);
  app.use(genericErrorHandler);
  return app;
}

async function post(err: unknown, body: object | string = {}) {
  return request(appThatThrows(err))
    .post('/boom')
    .set('content-type', 'application/json')
    .send(body);
}

describe('genericErrorHandler', () => {
  it('uses the status and code of an AppError', async () => {
    const res = await post(new NotFoundError('Workspace not found'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: 'Workspace not found',
      code: 'NOT_FOUND',
      correlationId: res.headers['x-correlation-id'],
    });
  });

  it('maps zod errors to 400 with details', async () => {
    const zodError = z.object({ name: z.string() }).safeParse({}).error;
    const res = await post(zodError);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0].path).toBe('name');
  });

  it('maps prisma P2025 to 404 and P2002 to 409', async () => {
    expect((await post(prismaError('P2025'))).status).toBe(404);
    const dup = await post(prismaError('P2002'));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CONFLICT');
  });

  it("keeps a better-auth APIError's 4xx status and message", async () => {
    const res = await post(
      new APIError('UNPROCESSABLE_ENTITY', { message: 'User already exists' }),
    );
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', message: 'User already exists' });

    const forbidden = await post(new APIError('FORBIDDEN', { message: 'Not yours' }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
  });

  it('keeps a better-auth APIError of 5xx a hidden 500', async () => {
    const res = await post(new APIError('INTERNAL_SERVER_ERROR', { message: 'db password wrong' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('hides the message of unexpected errors', async () => {
    const res = await post(new Error('secret connection string'));
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, code: 'INTERNAL' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('returns 400 for malformed JSON and 413 for a body over the limit', async () => {
    const malformed = await post(new ConflictError('unused'), '{"a":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.message).toBe('Malformed JSON body');

    const big = await post(new ConflictError('unused'), { text: 'more than ten bytes' });
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 400 for a path param with broken %-encoding', async () => {
    const app = express();
    app.get('/p/:id', (_req, res) => {
      res.json({});
    });
    app.use(genericErrorHandler);

    const res = await request(app).get('/p/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Malformed URL' });
  });

  it('does not treat an SDK error with a 4xx status as a client error', async () => {
    const plain = Object.assign(new Error('rate limited by provider'), { status: 429 });
    expect((await post(plain)).status).toBe(500);

    // OpenAI-style SDK errors carry a `type` as well.
    const typed = Object.assign(new Error('rate limited'), { status: 429, type: 'tokens' });
    expect((await post(typed)).status).toBe(500);
  });

  it('logs an error thrown after the response has started', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const app = express();
    app.get('/stream', (_req, res) => {
      res.write('partial');
      throw new Error('stream broke');
    });
    app.use(genericErrorHandler);

    // Express resets the connection, so the client sees a socket error.
    await request(app)
      .get('/stream')
      .catch(() => undefined);
    expect(log).toHaveBeenCalledWith(
      'error after response started',
      expect.objectContaining({ path: '/stream' }),
    );
    log.mockRestore();
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await request(appThatThrows(null)).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, code: 'NOT_FOUND' });
  });
});
