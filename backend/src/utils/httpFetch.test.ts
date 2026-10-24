import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FetchError, safeFetch } from './httpFetch.js';
import { allowTestAddresses } from './network.js';

const options = { timeoutMs: 2_000, maxBytes: 1024 };

let server: Server;
let base: string;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=UTF-8' });
      res.end('<p>hello</p>');
    } else if (path === '/to-private') {
      res.writeHead(302, { location: 'http://10.0.0.1/secret' });
      res.end();
    } else if (path === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
    } else if (path === '/hop') {
      res.writeHead(302, { location: '/page' });
      res.end();
    } else if (path === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('a'.repeat(5_000));
    } else if (path === '/chunked') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('a'.repeat(700));
      res.end('a'.repeat(700));
    } else if (path === '/gzip') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
      res.end(gzipSync('a'.repeat(100_000)));
    } else if (path === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    } else if (path === '/hang') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
    } else {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  allowTestAddresses([]);
});

describe('safeFetch address checks', () => {
  it('blocks a loopback address that is not allowlisted', async () => {
    await expect(safeFetch(`${base}/page`, options)).rejects.toThrow(/private/);
  });

  it('blocks cloud metadata without connecting', async () => {
    const error = await safeFetch('http://169.254.169.254/', options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FetchError);
    expect((error as Error).message).toMatch(/private/);
  });

  it('blocks a hostname that resolves to a private address', async () => {
    await expect(safeFetch('http://localhost/', options)).rejects.toThrow(/private/);
    await expect(safeFetch(`http://localhost:${port}/page`, options)).rejects.toBeInstanceOf(
      FetchError,
    );
  });

  it('refuses a redirect to a private address', async () => {
    allowTestAddresses(['127.0.0.1']);
    await expect(safeFetch(`${base}/to-private`, options)).rejects.toThrow(/private/);
  });
});

describe('safeFetch with the fixture server allowed', () => {
  it('returns the body, content type and final URL', async () => {
    allowTestAddresses(['127.0.0.1']);
    const res = await safeFetch(`${base}/page`, options);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html');
    expect(res.charset).toBe('UTF-8');
    expect(res.url).toBe(`${base}/page`);
    expect(res.body.toString()).toBe('<p>hello</p>');
  });

  it('follows a redirect and reports the final URL', async () => {
    allowTestAddresses(['127.0.0.1']);
    const res = await safeFetch(`${base}/hop`, options);
    expect(res.url).toBe(`${base}/page`);
    expect(res.body.toString()).toBe('<p>hello</p>');
  });

  it('returns an empty body for a non-2xx response', async () => {
    allowTestAddresses(['127.0.0.1']);
    const res = await safeFetch(`${base}/missing`, options);
    expect(res.status).toBe(404);
    expect(res.body.length).toBe(0);
  });

  it('refuses a redirect chain longer than the limit', async () => {
    allowTestAddresses(['127.0.0.1']);
    await expect(safeFetch(`${base}/loop`, options)).rejects.toThrow(/Too many redirects/);
  });

  it('refuses a body bigger than maxBytes', async () => {
    allowTestAddresses(['127.0.0.1']);
    await expect(safeFetch(`${base}/big`, options)).rejects.toThrow(/larger than/);
  });

  it('refuses a chunked body with no Content-Length that grows past maxBytes', async () => {
    allowTestAddresses(['127.0.0.1']);
    await expect(safeFetch(`${base}/chunked`, options)).rejects.toThrow(/larger than/);
  });

  it('refuses a gzip body whose decoded size exceeds maxBytes', async () => {
    allowTestAddresses(['127.0.0.1']);
    await expect(safeFetch(`${base}/gzip`, options)).rejects.toThrow(/larger than/);
  });

  it('refuses a content type that is not allowed', async () => {
    allowTestAddresses(['127.0.0.1']);
    await expect(
      safeFetch(`${base}/json`, { ...options, allowedContentTypes: ['text/html'] }),
    ).rejects.toThrow(/not a web page/);
  });

  it('gives up on a server that never finishes the body', async () => {
    allowTestAddresses(['127.0.0.1']);
    await expect(safeFetch(`${base}/hang`, { ...options, timeoutMs: 300 })).rejects.toThrow(
      /took too long/,
    );
  });
});

describe('safeFetch URL checks', () => {
  it('refuses other protocols', async () => {
    await expect(safeFetch('ftp://example.com/file', options)).rejects.toThrow(/http and https/);
    await expect(safeFetch('file:///etc/passwd', options)).rejects.toThrow(/http and https/);
  });

  it('refuses credentials in the URL', async () => {
    await expect(safeFetch('https://user:pass@example.com/', options)).rejects.toThrow(
      /credentials/,
    );
  });

  it('refuses non-standard ports on public hosts', async () => {
    await expect(safeFetch('http://93.184.215.14:8080/', options)).rejects.toThrow(/ports/);
  });
});

describe('allowTestAddresses', () => {
  afterEach(() => {
    vi.doUnmock('../config/index.js');
    vi.resetModules();
  });

  it('throws outside the test environment', async () => {
    vi.resetModules();
    vi.doMock('../config/index.js', () => ({ serverConfig: { NODE_ENV: 'production' } }));
    const network = await import('./network.js');
    expect(() => network.allowTestAddresses(['127.0.0.1'])).toThrow(/only be allowed in tests/);
    expect(network.isTestAddress('127.0.0.1')).toBe(false);
  });
});
