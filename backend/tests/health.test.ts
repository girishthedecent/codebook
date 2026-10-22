import { afterEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { testApp } from './helpers/app.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/v1/health/live', () => {
  it('is ok without touching the database', async () => {
    const ping = vi.spyOn(prismaClient, '$queryRaw');

    const res = await testApp().get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
    expect(ping).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/health/ready', () => {
  it('is ok when the database answers', async () => {
    const res = await testApp().get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: 'ok', db: 'ok', version: expect.any(String) },
    });
  });

  it('returns 503 when the database is down', async () => {
    vi.spyOn(prismaClient, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));

    const res = await testApp().get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, data: { status: 'degraded', db: 'down' } });
  });
});

describe('x-correlation-id', () => {
  it('echoes a valid incoming id and replaces an unsafe one', async () => {
    const kept = await testApp().get('/api/v1/health/live').set('x-correlation-id', 'abc-123');
    expect(kept.headers['x-correlation-id']).toBe('abc-123');

    const replaced = await testApp()
      .get('/api/v1/health/live')
      .set('x-correlation-id', 'has spaces; and "quotes"');
    expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
