import { useEffect, useState } from 'react';

// Unsent text survives a reload or a trip to another conversation. Storage can be missing or
// full (private windows), so every access is guarded and failure just means no draft.

const key = (scope: string) => `codebook.draft.${scope}`;

function read(scope: string) {
  try {
    return localStorage.getItem(key(scope)) ?? '';
  } catch {
    return '';
  }
}

function write(scope: string, value: string) {
  try {
    if (value) localStorage.setItem(key(scope), value);
    else localStorage.removeItem(key(scope));
  } catch {
    // ignore
  }
}

export function clearDraft(scope: string) {
  write(scope, '');
}

/** A text state that is mirrored to localStorage, written at most every 300 ms. */
export function useDraft(scope: string) {
  const [value, setValue] = useState(() => read(scope));

  useEffect(() => {
    const t = setTimeout(() => write(scope, value), 300);
    return () => clearTimeout(t);
  }, [scope, value]);

  return [value, setValue] as const;
}
