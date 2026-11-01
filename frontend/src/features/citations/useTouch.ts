import { useSyncExternalStore } from 'react';

const QUERY = '(hover: none)';

function subscribe(onChange: () => void) {
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/** True on a device that can't hover (a phone or tablet), where a tap has to do the previewing. */
export function useTouch() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
