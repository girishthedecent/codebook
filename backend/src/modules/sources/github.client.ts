import { appConfig } from '../../config/app.config.js';
import { serverConfig } from '../../config/index.js';
import logger from '../../config/logger.config.js';
import { UpstreamError } from '../../utils/errors/app.error.js';

export type GithubRepo = {
  fullName: string;
  isPrivate: boolean;
  // GitHub reports size in KB.
  sizeKb: number;
  defaultBranch: string;
};

async function githubGet(
  path: string,
  { accept = 'application/vnd.github+json', redirect = 'follow' as 'follow' | 'manual' } = {},
) {
  const headers: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CodeBook',
  };
  // Without a token GitHub allows 60 requests an hour per IP.
  if (serverConfig.GITHUB_TOKEN) headers.Authorization = `Bearer ${serverConfig.GITHUB_TOKEN}`;

  try {
    return await fetch(`${appConfig.github.apiUrl}${path}`, {
      headers,
      redirect,
      signal: AbortSignal.timeout(appConfig.github.timeoutMs),
    });
  } catch (error) {
    logger.warn('GitHub request failed', { path, error });
    throw new UpstreamError('GitHub');
  }
}

function failed(path: string, status: number): never {
  logger.warn('GitHub request failed', { path, status });
  throw new UpstreamError('GitHub', { status });
}

/** The repository, or null when it doesn't exist (or our token can't see it). */
export async function getRepo(owner: string, repo: string): Promise<GithubRepo | null> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await githubGet(path);
  if (res.status === 404) return null;
  if (!res.ok) failed(path, res.status);

  const body = (await res.json()) as {
    full_name: string;
    private: boolean;
    size: number;
    default_branch: string;
  };
  return {
    fullName: body.full_name,
    isPrivate: body.private,
    sizeKb: body.size,
    defaultBranch: body.default_branch,
  };
}

/** True when `ref` names a branch, tag or commit in the repository. */
export async function refExists(owner: string, repo: string, ref: string) {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`;
  const res = await githubGet(path);
  // 422 is GitHub's answer for a ref that isn't valid at all.
  if (res.status === 404 || res.status === 422) return false;
  if (!res.ok) failed(path, res.status);
  return true;
}

export type CommitLookup = { sha: string } | 'no-repo' | 'no-ref' | 'empty';

/** The commit a branch, tag or commit currently points to. */
export async function resolveCommit(
  owner: string,
  repo: string,
  ref: string,
): Promise<CommitLookup> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`;
  // This media type answers with the bare SHA instead of the whole commit.
  const res = await githubGet(path, { accept: 'application/vnd.github.sha' });
  if (res.status === 404) return 'no-repo';
  // 409 is a repository without commits; 422 a ref that doesn't exist.
  if (res.status === 409) return 'empty';
  if (res.status === 422) return 'no-ref';
  if (!res.ok) failed(path, res.status);
  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) failed(path, res.status);
  return { sha };
}

/**
 * The gzipped tarball of a commit, as a stream. The API answers with a redirect to
 * codeload.github.com, which is followed by hand so the token is only ever sent to the API.
 */
export async function downloadTarball(owner: string, repo: string, sha: string) {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${sha}`;
  const res = await githubGet(path, { redirect: 'manual' });
  const location = res.headers.get('location');
  // Only the Location header matters; let the connection go.
  await res.body?.cancel();
  if (res.status !== 302 || !location) failed(path, res.status);

  const url = URL.parse(location);
  if (url?.protocol !== 'https:' || url.hostname !== 'codeload.github.com') {
    // The host only: the redirect URL can carry a short-lived token.
    logger.warn('GitHub tarball redirect to an unexpected place', { path, host: url?.hostname });
    throw new UpstreamError('GitHub');
  }
  let archive: Response;
  try {
    archive = await fetch(url, {
      headers: { 'User-Agent': 'CodeBook' },
      // Covers reading the body too: the stream errors when it fires.
      signal: AbortSignal.timeout(appConfig.github.downloadTimeoutMs),
    });
  } catch (error) {
    logger.warn('GitHub tarball download failed', { path, error });
    throw new UpstreamError('GitHub');
  }
  if (!archive.ok || !archive.body) failed(path, archive.status);
  return archive.body;
}
