import { useEffect, useRef, useState } from 'react';

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

/**
 * A text state that is mirrored to localStorage, written at most every 300 ms. Leaving the
 * page inside that window still saves the last keystrokes.
 */
export function useDraft(scope: string) {
  const [value, setValue] = useState(() => read(scope));
  const latest = useRef({ scope, value, saved: value });

  useEffect(() => {
    latest.current = { scope, value, saved: latest.current.saved };
    const t = setTimeout(() => {
      write(scope, value);
      latest.current.saved = value;
    }, 300);
    return () => clearTimeout(t);
  }, [scope, value]);

  useEffect(() => {
    const save = () => {
      const l = latest.current;
      if (l.value !== l.saved) write(l.scope, l.value);
    };
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, []);

  return [value, setValue] as const;
}
