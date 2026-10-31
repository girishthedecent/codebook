import type { Source } from '@/api/types';

// owner/repo@ref, where owner and repo are GitHub names and the ref has no spaces.
const REPO_AT_REF = /^([\w.-]+\/[\w.-]+)@(\S+)$/;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * Repository sources are titled `owner/repo@<ref>`, where the ref is usually a 40-character
 * commit. Splits that into the name to show and a short ref to set beside it: a commit is cut
 * to 7 characters, a branch or tag is kept whole. Any other title is returned as it is.
 */
export function displayTitle(source: Pick<Source, 'title'> & { type?: Source['type'] }): {
  name: string;
  ref?: string;
} {
  if (source.type && source.type !== 'GITHUB_REPO') return { name: source.title };
  const match = REPO_AT_REF.exec(source.title.trim());
  if (!match) return { name: source.title };
  const [, name, ref] = match;
  return { name: name!, ref: COMMIT_SHA.test(ref!) ? ref!.slice(0, 7) : ref };
}
