import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'codebook.theme';

// The paper colour of each theme, as the browser chrome should show it. Keep in step with
// --paper in styles/tokens.css and the theme-color tags in index.html.
const CHROME = { light: '#f6f3ec', dark: '#000000' } as const;
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // storage blocked: behave as system
  }
  return 'system';
}

/** Applies the choice at once and remembers it. The inline script in index.html replays it on load. */
export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: the choice applies for this visit only
  }
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  syncChromeColor(theme);
  for (const l of listeners) l();
}

/**
 * The page ships one theme-color tag per scheme, each guarded by a media query. A manual choice
 * can disagree with the system, so while one is set both tags show its colour; "system" puts
 * each tag back on its own scheme.
 */
function syncChromeColor(theme: Theme) {
  const tags = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][media]');
  for (const tag of tags) {
    const own = tag.media.includes('dark') ? 'dark' : 'light';
    tag.content = CHROME[theme === 'system' ? own : theme];
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'system' as const);
  return [theme, setTheme];
}
