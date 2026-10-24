import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch, type Response } from 'undici';
import { isAllowedAddress, isTestAddress } from './network.js';

// Fetching URLs that users hand us. Checking the URL when it is saved isn't enough: DNS can
// answer differently by the time we fetch (rebinding), and a redirect can point anywhere.
// So every connection checks the address it actually connects to, and every redirect hop
// goes through the same checks as the first URL.

export const USER_AGENT = 'CodeBookBot/0.1';
const MAX_REDIRECTS = 5;

/** A fetch that was refused or failed; the message is safe to show the user. */
export class FetchError extends Error {}

/** The URL itself isn't allowed (private address, port, protocol): no retry will help. */
export class UrlRefusedError extends FetchError {}

class BlockedAddressError extends Error {}

// Hostnames are resolved here, at connect time. Every address must be allowed, not just
// the one we'd pick: otherwise a retry or a second connection could use another one.
const agent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
        if (error) return callback(error, []);
        if (
          addresses.length === 0 ||
          !addresses.every((entry) => isAllowedAddress(entry.address))
        ) {
          return callback(new BlockedAddressError(hostname), []);
        }
        if (options.all) return callback(null, addresses);
        return callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    },
  },
});

export type SafeFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
  // Media types (without parameters) a successful response may have; any when not given.
  allowedContentTypes?: string[];
  accept?: string;
};

export type FetchedResponse = {
  // After redirects.
  url: string;
  status: number;
  // Lowercase, without parameters; '' when the server sent none.
  contentType: string;
  charset: string | null;
  // Read only for 2xx responses; empty otherwise.
  body: Buffer;
};

/**
 * GETs a user-supplied http(s) URL: public addresses only (checked on connect, so DNS
 * rebinding can't get around it), ports 80 and 443, up to 5 redirects that are checked
 * the same way, and a timeout and size cap covering the whole body.
 */
export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<FetchedResponse> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = checkedUrl(raw);
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetch(url, {
        dispatcher: agent,
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: options.accept ?? '*/*' },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (hop >= MAX_REDIRECTS) throw new FetchError(`Too many redirects from ${raw}`);
        url = checkedUrl(location, url);
        continue;
      }
      return await readResponse(url, res, options);
    }
  } catch (error) {
    throw asFetchError(error, url);
  }
}

// Protocol, credentials, port and (for an IP literal, where no lookup happens) the address.
function checkedUrl(raw: string, base?: URL) {
  const url = URL.parse(raw, base?.href);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new UrlRefusedError(`Only http and https URLs can be fetched (${raw.slice(0, 200)})`);
  }
  if (url.username || url.password) {
    throw new UrlRefusedError('URLs with credentials are not supported');
  }
  url.hash = '';

  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) && !isAllowedAddress(host)) throw blocked(url);
  // A fixture server in tests runs on a random port.
  if (!['', '80', '443'].includes(url.port) && !(isIP(host) && isTestAddress(host))) {
    throw new UrlRefusedError(`Only the standard ports are supported (${url.host})`);
  }
  return url;
}

async function readResponse(url: URL, res: Response, options: SafeFetchOptions) {
  const header = res.headers.get('content-type') ?? '';
  const contentType = header.split(';')[0]!.trim().toLowerCase();
  const charset = /charset="?([^";\s]+)/i.exec(header)?.[1] ?? null;
  const result = { url: url.href, status: res.status, contentType, charset };
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return { ...result, body: Buffer.alloc(0) };
  }
  if (options.allowedContentTypes && !options.allowedContentTypes.includes(contentType)) {
    await res.body.cancel();
    throw new FetchError(`${url.href} is not a web page (${contentType || 'no content type'})`);
  }

  // Counted as it arrives: Content-Length can be missing or wrong.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    // Leaving the loop cancels the stream (it's locked to the iterator here).
    if (size > options.maxBytes) {
      throw new FetchError(`${url.href} is larger than ${Math.round(options.maxBytes / 1024)} KB`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return { ...result, body: Buffer.concat(chunks) };
}

function blocked(url: URL) {
  return new UrlRefusedError(`${url.host} points to a private or reserved network address`);
}

// undici wraps connection errors (ours from the lookup included) as causes of a TypeError.
function asFetchError(error: unknown, url: URL) {
  for (let cause = error, depth = 0; cause instanceof Error && depth < 5; depth++) {
    if (cause instanceof FetchError) return cause;
    if (cause instanceof BlockedAddressError) return blocked(url);
    if (cause.name === 'TimeoutError') return new FetchError(`${url.href} took too long to answer`);
    cause = cause.cause;
  }
  return new FetchError(`Couldn't fetch ${url.href}`);
}
