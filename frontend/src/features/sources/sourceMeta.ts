import type { Source, SourceStatus, SourceType } from '@/api/types';

/** The small mono label in front of a source title. Kept for the search results. */
export const typeMark: Record<SourceType, string> = {
  PDF: 'book',
  GITHUB_REPO: 'repo',
  WEBSITE: 'site',
};

export function isIndexing(status: SourceStatus) {
  return status === 'PENDING' || status === 'PROCESSING';
}

export function hostOf(url: string | undefined) {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export type NewSource =
  | { type: 'GITHUB_REPO'; owner: string; repo: string; ref?: string }
  | { type: 'WEBSITE'; url: string };

const COMMIT = /^[0-9a-f]{7,40}$/i;

/**
 * Finds the source that `input` would duplicate, the way the backend does: a repository is
 * the same one at the same ref (no ref means the default branch, and a short commit matches
 * the full one), a page is the same one without its #fragment.
 */
export function findDuplicate(sources: Source[], input: NewSource) {
  return sources.find((s) => {
    if (s.type !== input.type) return false;
    if (input.type === 'GITHUB_REPO') {
      const o = s.origin as { owner?: string; repo?: string; ref?: string; defaultBranch?: string };
      return (
        o.owner?.toLowerCase() === input.owner.toLowerCase() &&
        o.repo?.toLowerCase() === input.repo.toLowerCase() &&
        sameRef(o, input.ref)
      );
    }
    const stored = withoutFragment((s.origin as { url?: string }).url);
    return stored !== undefined && stored === withoutFragment(input.url);
  });
}

function sameRef(stored: { ref?: string; defaultBranch?: string }, wanted: string | undefined) {
  const ref = wanted?.trim();
  if (!ref) return stored.ref === stored.defaultBranch;
  if (stored.ref === ref) return true;
  return COMMIT.test(ref) && !!stored.ref?.toLowerCase().startsWith(ref.toLowerCase());
}

function withoutFragment(raw: string | undefined) {
  try {
    const url = new URL((raw ?? '').trim());
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
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

export function isHttpUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
