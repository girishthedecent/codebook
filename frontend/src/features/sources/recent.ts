import { useSyncExternalStore } from 'react';
import type { SourceType } from '@/api/types';
import type { ViewerTarget } from '@/lib/viewerParams';

/** A place the reader opened in the viewer, remembered on this device for the library. */
export type RecentPlace = {
  sourceId: string;
  title: string;
  type: SourceType;
  target: ViewerTarget;
  openedAt: number;
};

const KEEP = 6;
const keyFor = (workspaceId: string) => `codebook-recent:${workspaceId}`;

const EMPTY: RecentPlace[] = [];
const listeners = new Set<() => void>();
// useSyncExternalStore needs the same array back until something changes.
const cache = new Map<string, { raw: string | null; list: RecentPlace[] }>();

function read(workspaceId: string): RecentPlace[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(keyFor(workspaceId));
  } catch {
    return EMPTY;
  }
  const hit = cache.get(workspaceId);
  if (hit && hit.raw === raw) return hit.list;
  let list: RecentPlace[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter(isPlace);
  } catch {
    list = [];
  }
  cache.set(workspaceId, { raw, list });
  return list;
}

function isPlace(value: unknown): value is RecentPlace {
  const v = value as Partial<RecentPlace> | null;
  return (
    typeof v?.sourceId === 'string' &&
    typeof v.title === 'string' &&
    typeof v.openedAt === 'number' &&
    typeof v.target === 'object' &&
    v.target !== null
  );
}

/** Puts a place first, one entry per source: the last place read in each book is what counts. */
export function rememberPlace(workspaceId: string, place: Omit<RecentPlace, 'openedAt'>) {
  const list = read(workspaceId).filter((p) => p.sourceId !== place.sourceId);
  const next = [{ ...place, openedAt: Date.now() }, ...list].slice(0, KEEP);
  try {
    localStorage.setItem(keyFor(workspaceId), JSON.stringify(next));
  } catch {
    return;
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Another tab reading in the same workspace.
  window.addEventListener('storage', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', fn);
  };
}

export function useRecentPlaces(workspaceId: string) {
  return useSyncExternalStore(
    subscribe,
    () => read(workspaceId),
    () => EMPTY,
  );
}

/** "p. 42", "model.py", "Decoding strategies". */
export function placeLabel(place: Pick<RecentPlace, 'target' | 'type'>) {
  const { target } = place;
  if (target.kind === 'page') return `p. ${target.page}`;
  if (target.heading) return target.heading;
  if (place.type === 'GITHUB_REPO') return target.path.split('/').pop() || target.path;
  try {
    const url = new URL(target.path);
    return url.pathname === '/' ? url.host : url.pathname.replace(/\/$/, '');
  } catch {
    return target.path;
  }
}
