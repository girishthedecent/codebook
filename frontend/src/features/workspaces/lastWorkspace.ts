import { useEffect } from 'react';

// Which workspace `/w` reopens. A per-browser convenience, so failures to store are ignored.
const KEY = 'codebook.lastWorkspace';

export function lastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** On sign-out: the next person on this browser must not be sent to this account's workspace. */
export function clearLastWorkspace() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

export function forgetWorkspace(workspaceId: string) {
  try {
    if (localStorage.getItem(KEY) === workspaceId) localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

/** Called by the workspace shell so the next visit to `/w` lands here. */
export function useRememberWorkspace(workspaceId: string) {
  useEffect(() => {
    try {
      localStorage.setItem(KEY, workspaceId);
    } catch {
      // storage unavailable
    }
  }, [workspaceId]);
}
