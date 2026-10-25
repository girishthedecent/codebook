import { useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';

function focusMain() {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  main.tabIndex = -1;
  main.focus({ preventScroll: true });
}

/** First link on every page: jumps past the navigation to the page itself. */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        focusMain();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded-sm focus:border focus:border-rule-2 focus:bg-paper focus:px-3 focus:py-2 focus:text-sm"
    >
      Skip to content
    </a>
  );
}

/**
 * After a page change, sets the tab title from the page heading and moves focus to the main
 * area so keyboard and screen reader users start at the top of the new page. Changes that only
 * touch the query string (opening the viewer, paging) are left alone, and so is a page that
 * already put focus somewhere inside itself.
 */
export function useRouteFocus() {
  const router = useRouter();
  const last = useRef<string | null>(null);
  useEffect(
    () =>
      router.subscribe('onResolved', ({ toLocation }) => {
        const path = toLocation.pathname;
        const first = last.current === null;
        const moved = path !== last.current;
        last.current = path;
        if (!moved) return;
        requestAnimationFrame(() => {
          const h1 = document.querySelector('main h1')?.textContent?.trim();
          document.title = h1 ? `${h1} · CodeBook` : 'CodeBook';
          if (first) return;
          const main = document.querySelector('main');
          const active = document.activeElement;
          if (active && active !== document.body && main?.contains(active)) return;
          focusMain();
        });
      }),
    [router],
  );
}
