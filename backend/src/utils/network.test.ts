import { lookup } from 'node:dns/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, isPublicIp } from './network.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const resolveTo = (...addresses: string[]) =>
  vi
    .mocked(lookup)
    .mockResolvedValue(
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as never,
    );

beforeEach(() => {
  vi.mocked(lookup).mockReset();
});

describe('isPublicIp', () => {
  it('blocks loopback, private, link-local and special ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::7f00:1',
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.215.14', '2606:4700::1111']) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it('rejects things that are not IPs', () => {
    expect(isPublicIp('example.com')).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('accepts a host that resolves to public addresses', async () => {
    resolveTo('93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c');
    await expect(assertPublicUrl('https://example.com/docs')).resolves.toBeInstanceOf(URL);
  });

  it('rejects a host that resolves to a private address, even alongside public ones', async () => {
    resolveTo('93.184.215.14', '10.0.0.5');
    await expect(assertPublicUrl('https://internal.example.com')).rejects.toThrow(/private/);
  });

  it('rejects private IP literals without a DNS lookup', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:8080/')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private/,
    );
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow(/private/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects other schemes and embedded credentials', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/http and https/);
    await expect(assertPublicUrl('ftp://example.com/')).rejects.toThrow(/http and https/);
    await expect(assertPublicUrl('https://user:pass@example.com/')).rejects.toThrow(/credentials/);
  });

  it('rejects a host that does not resolve', async () => {
    vi.mocked(lookup).mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }));
    await expect(assertPublicUrl('https://no-such-host.example')).rejects.toThrow(
      /unknown or on a private/,
    );
  });

  it('rejects ports the crawler would refuse', async () => {
    resolveTo('93.184.215.14');
    await expect(assertPublicUrl('https://example.com:8443/docs')).rejects.toThrow(
      /standard ports/,
    );
    await expect(assertPublicUrl('https://example.com:443/docs')).resolves.toBeInstanceOf(URL);
  });
});
