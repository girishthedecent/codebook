import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { serverConfig } from '../config/index.js';
import { BadRequestError } from './errors/app.error.js';

// Addresses a user-supplied URL must never reach: this machine, private networks, cloud
// metadata (169.254.169.254) and other special ranges.
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  // No ::ffff:0:0/96 rule: BlockList already checks IPv4-mapped addresses (::ffff:127.0.0.1)
  // against the IPv4 rules, and that rule would match every IPv4 address.
  ['64:ff9b::', 96], // NAT64: reaches IPv4 hosts through a gateway
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPublicIp(ip: string) {
  const version = isIP(ip);
  if (version === 0) return false;
  return !blocked.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

// Addresses tests may fetch from (a fixture server on 127.0.0.1). Empty outside tests.
let testAddresses = new Set<string>();

/** Lets fetches reach these addresses, on any port. Tests only: throws anywhere else. */
export function allowTestAddresses(addresses: string[]) {
  if (serverConfig.NODE_ENV !== 'test') {
    throw new Error('Test addresses can only be allowed in tests');
  }
  testAddresses = new Set(addresses);
}

export function isTestAddress(ip: string) {
  return testAddresses.has(ip);
}

/** What a server-side fetch of a user-supplied URL may connect to. */
export function isAllowedAddress(ip: string) {
  return isPublicIp(ip) || isTestAddress(ip);
}

/**
 * Checks that a URL is plain http(s) and that every address its host resolves to is
 * public. This is an early, friendly check when a URL is saved: DNS can change before the
 * fetch, so whatever fetches the URL has to check the address it actually connects to.
 */
export async function assertPublicUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestError('Only http and https URLs are supported');
  }
  if (url.username || url.password) {
    throw new BadRequestError('URLs with credentials are not supported');
  }

  // IPv6 literals come wrapped in brackets: http://[::1]/
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  let addresses: string[] = [];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      // Same answer as a private host: telling them apart would reveal internal host names.
    }
  }

  if (addresses.length === 0 || !addresses.every(isPublicIp)) {
    throw new BadRequestError('URL host is unknown or on a private or reserved network');
  }
  // The crawler only connects to the standard ports.
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new BadRequestError('Only URLs on the standard ports (80, 443) are supported');
  }
  return url;
}
