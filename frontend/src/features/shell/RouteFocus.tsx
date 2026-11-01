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

function setTitleFromHeading() {
  const h1 = document.querySelector('main h1')?.textContent?.trim();
  const title = h1 ? `${h1} · CodeBook` : 'CodeBook';
  if (document.title !== title) document.title = title;
}

/**
 * Keeps the tab title in step with the page heading for as long as the app runs. A heading
 * often arrives after the route settles (data loads, a conversation is renamed), so this
 * watches `<main>` rather than reading the heading once. Until a `<main>` exists it watches
 * the body, and moves to `<main>` as soon as there is one.
 */
function watchTitle() {
  let frame = 0;
  let watched: Element | null = null;
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      attach();
      setTitleFromHeading();
    });
  });
  function attach() {
    const main = document.querySelector('main');
    if (main && main === watched) return;
    observer.disconnect();
    watched = main;
    observer.observe(main ?? document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  attach();
  return {
    attach,
    stop() {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

/**
 * After a page change, moves focus to the main area so keyboard and screen reader users start
 * at the top of the new page, and keeps the tab title in step with the page heading. Changes
 * that only touch the query string (opening the viewer, paging) leave focus alone, and so does
 * a page that already put focus somewhere inside itself.
 */
export function useRouteFocus() {
  const router = useRouter();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const title = watchTitle();
    const stopRouter = router.subscribe('onResolved', ({ toLocation }) => {
      const path = toLocation.pathname;
      const first = last.current === null;
      const moved = path !== last.current;
      last.current = path;
      if (!moved) return;
      requestAnimationFrame(() => {
        title.attach();
        setTitleFromHeading();
        if (first) return;
        const main = document.querySelector('main');
        const active = document.activeElement;
        if (active && active !== document.body && main?.contains(active)) return;
        focusMain();
      });
    });
    return () => {
      stopRouter();
      title.stop();
    };
  }, [router]);
}
