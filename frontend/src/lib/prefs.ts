import { useSyncExternalStore } from 'react';

// Reading preferences, kept in this browser. Each one is mirrored as a data attribute on <html>
// (`data-text-size`, `data-measure`) that base.css reads; the default is the absence of the
// attribute, so the stylesheet needs no rule for it. The inline script in index.html sets the
// attributes again on load, before the first paint.

export type TextSize = 's' | 'm' | 'l';
export type Measure = 'narrow' | 'wide';

type Prefs = { textSize: TextSize; measure: Measure };

const DEFAULTS: Prefs = { textSize: 'm', measure: 'narrow' };

// Keep these keys and values in step with the boot script in index.html.
const STORE = {
  textSize: { key: 'codebook.textSize', attr: 'textSize', values: ['s', 'm', 'l'] },
  measure: { key: 'codebook.measure', attr: 'measure', values: ['narrow', 'wide'] },
} as const;

const listeners = new Set<() => void>();

function read<K extends keyof Prefs>(name: K): Prefs[K] {
  const { key, values } = STORE[name];
  try {
    const stored = localStorage.getItem(key);
    if ((values as readonly string[]).includes(stored ?? '')) return stored as Prefs[K];
  } catch {
    // storage blocked: the default applies
  }
  return DEFAULTS[name];
}

/** Applies a preference at once and remembers it; the default clears both. */
export function setPref<K extends keyof Prefs>(name: K, value: Prefs[K]) {
  const { key, attr } = STORE[name];
  const isDefault = value === DEFAULTS[name];
  try {
    if (isDefault) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice applies for this visit only
  }
  if (isDefault) delete document.documentElement.dataset[attr];
  else document.documentElement.dataset[attr] = value;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function usePref<K extends keyof Prefs>(name: K): [Prefs[K], (value: Prefs[K]) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(name),
    () => DEFAULTS[name],
  );
  return [value, (next) => setPref(name, next)];
}
