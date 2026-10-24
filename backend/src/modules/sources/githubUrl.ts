import { BadRequestError } from '../../utils/errors/app.error.js';

// What a GitHub source's URL and ref may look like, checked before any GitHub request.

const GITHUB_URL = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/(.+?))?\/?$/;

/** owner, repo and optional ref from https://github.com/{owner}/{repo}(/tree/{ref}). */
export function parseGithubUrl(raw: string) {
  const url = new URL(raw);
  const match = GITHUB_URL.exec(url.pathname);
  if (!['github.com', 'www.github.com'].includes(url.hostname) || !match) {
    throw new BadRequestError('Expected a URL like https://github.com/owner/repo');
  }
  let ref: string | undefined;
  try {
    ref = match[3] === undefined ? undefined : decodeURIComponent(match[3]);
  } catch {
    throw new BadRequestError('The branch in the URL is not valid');
  }
  return { owner: match[1]!, repo: match[2]!, ref };
}

/**
 * Git's own rules for ref names (git check-ref-format), so a name like "." or "a..b" is
 * refused here instead of reaching the GitHub API as a different path.
 */
export function isValidGitRef(ref: string) {
  // Control characters and space.
  const hasControl = [...ref].some((char) => char.charCodeAt(0) <= 0x20 || char === '\u007f');
  return (
    ref.length > 0 &&
    ref !== '@' &&
    !hasControl &&
    !/[~^:?*[\\]/.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    !ref.includes('@{') &&
    // No part may start with a dot or end in .lock; no leading/trailing slash or dot.
    !/^[./]|[./]$|\.lock(\/|$)|\/\./.test(ref)
  );
}
