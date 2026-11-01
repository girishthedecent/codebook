import { useSyncExternalStore } from 'react';
import type { ViewerTarget } from './viewerParams';

/**
 * A passage the user wants to ask about: selected text in the viewer, a flashcard, a graph
 * symbol. Whoever has it calls `askAbout`; the composer on the page picks it up, quotes it and
 * takes focus. One at a time, and it is dropped once the question is sent or dismissed.
 */
export type AskAbout = {
  quote: string;
  /** Where it comes from, as a citation would say it: "model.py, lines 42–61". */
  label: string;
  target?: ViewerTarget;
};

const MAX_QUOTE = 1_200;

let current: AskAbout | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function askAbout(next: AskAbout) {
  const quote = next.quote.replace(/\s+/g, ' ').trim();
  if (!quote) return;
  current = { ...next, quote: quote.length > MAX_QUOTE ? `${quote.slice(0, MAX_QUOTE - 1)}…` : quote };
  emit();
}

export function clearAskAbout() {
  if (!current) return;
  current = null;
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useAskAbout() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** The passage as it goes into the message box. */
export function quoteFor({ quote, label }: AskAbout) {
  const lines = quote.split('\n').map((line) => `> ${line}`);
  return `${lines.join('\n')}\n> — ${label}\n\n`;
}
