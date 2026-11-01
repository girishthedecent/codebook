import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { getTheme, setTheme } from '@/lib/theme';

// Small browser hooks for the landing page. Each returns the same value on the server and on
// the first client render, so the prerendered markup and the hydrated page agree.

function mediaQuery(query: string) {
  return {
    subscribe(onChange: () => void) {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    get: () => window.matchMedia(query).matches,
  };
}

const reduced = mediaQuery('(prefers-reduced-motion: reduce)');

export function useReducedMotion() {
  return useSyncExternalStore(reduced.subscribe, reduced.get, () => false);
}

const systemDark = mediaQuery('(prefers-color-scheme: dark)');
const themeListeners = new Set<() => void>();

function subscribeTheme(onChange: () => void) {
  themeListeners.add(onChange);
  const stop = systemDark.subscribe(onChange);
  return () => {
    themeListeners.delete(onChange);
    stop();
  };
}

function currentlyDark() {
  const chosen = getTheme();
  return chosen === 'system' ? systemDark.get() : chosen === 'dark';
}

/** Whether the page is dark now (the stored choice, else the system's), and a way to flip it. */
export function useDarkTheme(): [boolean, () => void] {
  const dark = useSyncExternalStore(subscribeTheme, currentlyDark, () => true);
  const toggle = () => {
    setTheme(dark ? 'light' : 'dark');
    for (const listener of themeListeners) listener();
  };
  return [dark, toggle];
}

/** True once the element has been on screen. */
export function useSeen(ref: RefObject<Element | null>, threshold = 0.25) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}

export type Visitor = 'unknown' | 'none' | 'guest' | 'member';

/**
 * Who is looking: a signed-in person is offered their workspace instead of the demo. Asks the
 * auth service directly (it answers `null` for no session, so the console stays clean) rather
 * than loading the app's API client.
 */
export function useVisitor(): Visitor {
  const [visitor, setVisitor] = useState<Visitor>('unknown');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/get-session', { credentials: 'include', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { user?: { isAnonymous?: boolean } } | null) => {
        setVisitor(!body?.user ? 'none' : body.user.isAnonymous ? 'guest' : 'member');
      })
      .catch(() => {
        if (!controller.signal.aborted) setVisitor('none');
      });
    return () => controller.abort();
  }, []);
  return visitor;
}
