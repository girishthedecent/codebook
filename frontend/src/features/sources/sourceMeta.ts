import type { Source, SourceStatus, SourceType } from '@/api/types';
import { strings } from './strings';

/** The small mono label in front of a source title. */
export const typeMark: Record<SourceType, string> = {
  PDF: 'book',
  GITHUB_REPO: 'repo',
  WEBSITE: 'site',
};

export function isIndexing(status: SourceStatus) {
  return status === 'PENDING' || status === 'PROCESSING';
}

type RepoOrigin = { owner?: string; repo?: string; ref?: string; defaultBranch?: string };
type WebOrigin = { url?: string };
type Stats = { pages?: number; files?: number; chunks?: number; commitSha?: string };

/** "491 pages", "100 files · 1c6f1b0", "expressjs.com". */
export function secondaryLine(source: Source): string {
  const stats = source.stats as Stats;
  switch (source.type) {
    case 'PDF':
      return stats.pages ? `${stats.pages} pages` : '';
    case 'GITHUB_REPO': {
      const origin = source.origin as RepoOrigin;
      const name = origin.owner && origin.repo ? `${origin.owner}/${origin.repo}` : '';
      const sha = stats.commitSha?.slice(0, 7);
      const files = stats.files ? `${stats.files} files` : '';
      return [name, files, sha].filter(Boolean).join(' · ');
    }
    case 'WEBSITE': {
      const host = hostOf((source.origin as WebOrigin).url);
      const pages = stats.pages && stats.pages > 1 ? `${stats.pages} pages` : '';
      return [host, pages].filter(Boolean).join(' · ');
    }
  }
}

/** "Indexing · embedding" while it runs, the plain status otherwise. */
export function statusText(source: Source): string {
  if (source.status === 'PROCESSING')
    return `${strings.status.PROCESSING} · ${strings.stage[source.stage]}`;
  return strings.status[source.status];
}

export function hostOf(url: string | undefined) {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Finds the source a 409 "already in the workspace" refers to, when it can be told apart. */
export function findDuplicate(
  sources: Source[],
  input: { type: 'GITHUB_REPO'; owner: string; repo: string } | { type: 'WEBSITE'; url: string },
) {
  return sources.find((s) => {
    if (s.type !== input.type) return false;
    if (input.type === 'GITHUB_REPO') {
      const o = s.origin as RepoOrigin;
      return (
        o.owner?.toLowerCase() === input.owner.toLowerCase() &&
        o.repo?.toLowerCase() === input.repo.toLowerCase()
      );
    }
    return normalizeUrl((s.origin as WebOrigin).url) === normalizeUrl(input.url);
  });
}

const GITHUB_SHORT = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;

/**
 * Accepts `owner/repo` or a github.com link (with /tree/{ref}), like the backend does.
 * Returns the canonical URL to send plus a ref taken from the link, or null when invalid.
 */
export function parseRepoInput(
  raw: string,
): { url: string; owner: string; repo: string; ref?: string } | null {
  const value = raw
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const short = GITHUB_SHORT.exec(value);
  if (short) {
    const [, owner, repo] = short;
    return { url: `https://github.com/${owner}/${repo}`, owner: owner!, repo: repo! };
  }
  let url: URL;
  try {
    url = new URL(withScheme(value));
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !['github.com', 'www.github.com'].includes(url.hostname))
    return null;
  // Pasted from the address bar, so the link may point at a branch, a file or an issue.
  const match = /^\/([^/]+)\/([^/]+)(?:\/tree\/(.+)|\/.*)?$/.exec(url.pathname);
  if (!match || !GITHUB_SHORT.test(`${match[1]}/${match[2]}`)) return null;
  const [, owner, repo, ref] = match;
  return {
    url: `https://github.com/${owner}/${repo}`,
    owner: owner!,
    repo: repo!,
    ref: ref ? safeDecode(ref) : undefined,
  };
}

/** `github.com/o/r` and `git@github.com:o/r` are what people paste; give them a scheme. */
function withScheme(value: string) {
  const ssh = /^git@github\.com:(.+)$/.exec(value);
  if (ssh) return `https://github.com/${ssh[1]}`;
  return /^(www\.)?github\.com\//i.test(value) ? `https://${value}` : value;
}

function safeDecode(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function normalizeUrl(raw: string | undefined) {
  try {
    return new URL((raw ?? '').trim()).href;
  } catch {
    return raw;
  }
}

export function isHttpUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
