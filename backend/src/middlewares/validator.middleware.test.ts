import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { genericErrorHandler } from './error.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from './validator.middleware.js';

const app = express();
app.use(express.json());
app.post(
  '/items/:id',
  validateRequestParams(z.object({ id: z.string().min(3) })),
  validateQueryParams(z.object({ limit: z.coerce.number().int().max(100).default(20) })),
  validateRequestBody(z.object({ name: z.string().trim().min(1) })),
  (req, res) => {
    res.json({ body: req.body, query: res.locals.query, params: res.locals.params });
  },
);
app.use(genericErrorHandler);

describe('validators', () => {
  it('pass parsed values to the handler', async () => {
    const res = await request(app).post('/items/abc?limit=5').send({ name: '  book ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      body: { name: 'book' },
      query: { limit: 5 },
      params: { id: 'abc' },
    });
  });

  it('reject bad params, query and body with the failing field', async () => {
    const params = await request(app).post('/items/a').send({ name: 'x' });
    expect(params.status).toBe(400);
    expect(params.body.message).toBe('Invalid path params');

    const query = await request(app).post('/items/abc?limit=500').send({ name: 'x' });
    expect(query.body.message).toBe('Invalid query params');

    const body = await request(app).post('/items/abc').send({});
    expect(body.body.message).toBe('Invalid request body');
    expect(body.body.details).toEqual([{ path: 'name', message: expect.any(String) }]);
  });
});
