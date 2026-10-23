import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bucketReachable,
  deleteObject,
  deletePrefix,
  getObjectStream,
  headObject,
  putObject,
} from '../src/utils/storage.js';

// Runs against the real codebook-test bucket; everything lives under one random prefix.
const prefix = `tests/${randomUUID()}/`;

afterAll(async () => {
  await deletePrefix(prefix);
});

describe('storage', () => {
  it('reaches the test bucket', async () => {
    expect(await bucketReachable()).toBe(true);
  });

  it('stores, reads, describes and deletes an object', async () => {
    const key = `${prefix}hello.txt`;
    await putObject(key, Buffer.from('hello'), { contentType: 'text/plain', contentLength: 5 });

    expect(await headObject(key)).toEqual({ size: 5, contentType: 'text/plain' });
    expect(await text(await getObjectStream(key))).toBe('hello');

    await deleteObject(key);
    expect(await headObject(key)).toBeNull();
  });

  it('uploads from a stream', async () => {
    const key = `${prefix}stream.txt`;
    const body = 'x'.repeat(10_000);
    await putObject(key, Readable.from([body]), {
      contentType: 'text/plain',
      contentLength: body.length,
    });
    expect((await headObject(key))?.size).toBe(10_000);
  });

  it('deletes everything under a prefix and nothing outside it', async () => {
    const inside = `${prefix}folder/`;
    for (const name of ['a', 'b', 'c']) {
      await putObject(`${inside}${name}`, Buffer.from(name), {
        contentType: 'text/plain',
        contentLength: 1,
      });
    }
    await putObject(`${prefix}keep`, Buffer.from('k'), {
      contentType: 'text/plain',
      contentLength: 1,
    });

    expect(await deletePrefix(inside)).toBe(3);
    expect(await headObject(`${inside}a`)).toBeNull();
    expect(await headObject(`${prefix}keep`)).not.toBeNull();
  });

  it('refuses a prefix that is not a folder', async () => {
    await expect(deletePrefix('')).rejects.toThrow(/Refusing/);
    await expect(deletePrefix('users/abc')).rejects.toThrow(/Refusing/);
  });
});
