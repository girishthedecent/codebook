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

async function githubGet(path: string) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CodeBook',
  };
  // Without a token GitHub allows 60 requests an hour per IP.
  if (serverConfig.GITHUB_TOKEN) headers.Authorization = `Bearer ${serverConfig.GITHUB_TOKEN}`;

  try {
    return await fetch(`${appConfig.github.apiUrl}${path}`, {
      headers,
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
