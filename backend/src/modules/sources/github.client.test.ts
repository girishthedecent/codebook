import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../../utils/errors/app.error.js';
import { downloadTarball, resolveCommit } from './github.client.js';

const SHA = 'a'.repeat(40);

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headersOf(call: unknown[]) {
  return new Headers((call[1] as { headers: Record<string, string> }).headers);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveCommit', () => {
  it('asks for the bare SHA and encodes the ref', async () => {
    const fetchMock = stubFetch(new Response(SHA));
    await resolveCommit('acme', 'widgets', 'release/v2');
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe('https://api.github.com/repos/acme/widgets/commits/release%2Fv2');
    expect(headersOf(call).get('accept')).toBe('application/vnd.github.sha');
  });

  it('returns the SHA of a 200 answer', async () => {
    stubFetch(new Response(`${SHA}\n`));
    await expect(resolveCommit('acme', 'widgets', 'main')).resolves.toEqual({ sha: SHA });
  });

  it.each([
    [404, 'no-repo'],
    [409, 'empty'],
    [422, 'no-ref'],
  ])('maps %i to %s', async (status, expected) => {
    stubFetch(new Response('', { status }));
    await expect(resolveCommit('acme', 'widgets', 'main')).resolves.toBe(expected);
  });

  it('throws UpstreamError on a server error', async () => {
    stubFetch(new Response('', { status: 500 }));
    await expect(resolveCommit('acme', 'widgets', 'main')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('throws UpstreamError when a 200 body is not a SHA', async () => {
    stubFetch(new Response('{"message":"hello"}'));
    await expect(resolveCommit('acme', 'widgets', 'main')).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('downloadTarball', () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it('follows the redirect by hand and sends no token to codeload', async () => {
    const fetchMock = stubFetch(
      redirect('https://codeload.github.com/acme/widgets/legacy.tar.gz/abc'),
      new Response('tarball-bytes'),
    );
    const body = await downloadTarball('acme', 'widgets', SHA);

    const first = fetchMock.mock.calls[0]!;
    expect(first[0]).toBe(`https://api.github.com/repos/acme/widgets/tarball/${SHA}`);
    expect((first[1] as RequestInit).redirect).toBe('manual');

    const second = fetchMock.mock.calls[1]!;
    expect(String(second[0])).toBe('https://codeload.github.com/acme/widgets/legacy.tar.gz/abc');
    expect(headersOf(second).has('authorization')).toBe(false);

    expect(await new Response(body).text()).toBe('tarball-bytes');
  });

  it.each([
    ['another host', 'https://evil.example.com/x'],
    ['plain http', 'http://codeload.github.com/acme/widgets/legacy.tar.gz/abc'],
    ['a relative path', '/acme/widgets/legacy.tar.gz/abc'],
  ])('refuses a redirect to %s without a second request', async (_name, location) => {
    const fetchMock = stubFetch(redirect(location));
    await expect(downloadTarball('acme', 'widgets', SHA)).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws UpstreamError when the API does not answer with a 302', async () => {
    const fetchMock = stubFetch(new Response('tarball', { status: 200 }));
    await expect(downloadTarball('acme', 'widgets', SHA)).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws UpstreamError when the download itself fails', async () => {
    stubFetch(
      redirect('https://codeload.github.com/acme/widgets/legacy.tar.gz/abc'),
      new Response('', { status: 404 }),
    );
    await expect(downloadTarball('acme', 'widgets', SHA)).rejects.toBeInstanceOf(UpstreamError);
  });
});
