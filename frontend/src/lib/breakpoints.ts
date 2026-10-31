import { useSyncExternalStore } from 'react';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

// Phone below 720px, tablet to 1099px, desktop from 1100px: the widths of the sm and lg
// breakpoints in styles/tokens.css, so `max-sm:` and `useBreakpoint() === 'phone'` agree.
const TABLET = '(min-width: 720px)';
const DESKTOP = '(min-width: 1100px)';

function current(): Breakpoint {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(DESKTOP).matches) return 'desktop';
  if (window.matchMedia(TABLET).matches) return 'tablet';
  return 'phone';
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const lists = [window.matchMedia(TABLET), window.matchMedia(DESKTOP)];
  for (const l of lists) l.addEventListener('change', onChange);
  return () => {
    for (const l of lists) l.removeEventListener('change', onChange);
  };
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, current, () => 'desktop');
}
