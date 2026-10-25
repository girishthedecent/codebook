import { useEffect, useEffectEvent } from 'react';

/**
 * Shortcut names: `mod+k` (⌘ on Mac, Ctrl elsewhere), `/`, `escape`, `[`, `]`, `shift+enter`…
 * Plain keys are ignored while the user types in a field unless `allowInInput` is set;
 * `mod+` and `escape` always fire.
 */
export type ShortcutOptions = {
  allowInInput?: boolean;
  enabled?: boolean;
};

export function useShortcut(
  keys: string | string[],
  handler: (event: KeyboardEvent) => void,
  { allowInInput = false, enabled = true }: ShortcutOptions = {},
) {
  // Always calls the latest handler without re-binding the listener on every render.
  const fire = useEffectEvent((event: KeyboardEvent) => handler(event));
  const list = Array.isArray(keys) ? keys.join('|') : keys;

  useEffect(() => {
    if (!enabled) return;
    const combos = list.split('|').map(parseCombo);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const combo = combos.find((c) => matches(c, event));
      if (!combo) return;
      if (!allowInInput && !combo.mod && combo.key !== 'escape' && isTyping(event.target)) return;
      event.preventDefault();
      fire(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list, allowInInput, enabled]);
}

type Combo = { key: string; mod: boolean; shift: boolean; alt: boolean };

export function parseCombo(input: string): Combo {
  const parts = input.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  return {
    key: key === 'esc' ? 'escape' : key,
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  };
}

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);

function matches(combo: Combo, event: KeyboardEvent) {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (combo.mod !== mod) return false;
  if (combo.alt !== event.altKey) return false;
  // Shift changes the character for punctuation, so only check it when the combo names it.
  if (combo.shift && !event.shiftKey) return false;
  return event.key.toLowerCase() === combo.key;
}

export function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Label for a shortcut as shown in menus and the shortcuts sheet: `⌘K` or `Ctrl K`. */
export function shortcutLabel(input: string) {
  const c = parseCombo(input);
  const key = c.key === 'escape' ? 'Esc' : c.key.length === 1 ? c.key.toUpperCase() : c.key;
  const parts = [
    c.mod && (isMac ? '⌘' : 'Ctrl'),
    c.alt && (isMac ? '⌥' : 'Alt'),
    c.shift && (isMac ? '⇧' : 'Shift'),
    key,
  ];
  return parts.filter(Boolean).join(isMac ? '' : ' ');
}
