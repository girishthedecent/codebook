// The sign-in fork writes this key when a workspace opens; pages outside a workspace read it to
// offer the way back. Read directly so this folder doesn't depend on that one.
const KEY = 'codebook.lastWorkspace';

export function readLastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
