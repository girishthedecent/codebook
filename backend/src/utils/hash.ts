import { createHash } from 'node:crypto';

/** Hex sha256 of the parts, each followed by a separator so ["ab", "c"] ≠ ["a", "bc"]. */
export function sha256(...parts: string[]) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
}
