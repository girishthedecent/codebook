import { shortcutLabel } from '@/lib/keyboard';

export type ShortcutRow = { keys: string[]; label: string };

/** What the keyboard does, as the command menu lists it. */
export const shortcutRows: ShortcutRow[] = [
  { keys: [shortcutLabel('mod+k')], label: 'Search and commands' },
  { keys: ['/'], label: 'Focus the message box' },
  { keys: ['Esc'], label: 'Close the viewer or a dialog' },
  { keys: ['[', ']'], label: 'Previous and next page in the viewer' },
  { keys: ['←', '→'], label: 'Previous and next flashcard' },
  { keys: ['1–6', 'Enter'], label: 'Pick a quiz answer, then go on' },
];
