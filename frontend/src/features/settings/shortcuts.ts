import { shortcutLabel } from '@/lib/keyboard';
import { strings } from '@/features/account/strings';

export type ShortcutRow = { keys: string[]; label: string };

const t = strings.settings.shortcutRows;

/** What the keyboard does, as Settings and the shortcuts dialog list it. */
export const shortcutRows: ShortcutRow[] = [
  { keys: [shortcutLabel('mod+k')], label: t.command },
  { keys: ['?'], label: t.help },
  { keys: ['/'], label: t.composer },
  { keys: ['Esc'], label: t.close },
  { keys: ['[', ']'], label: t.citations },
  { keys: ['PgUp', 'PgDn'], label: t.pages },
  { keys: [shortcutLabel('mod+f')], label: t.find },
  { keys: ['←', '→'], label: t.cards },
  { keys: ['K', 'D'], label: t.know },
  { keys: ['1–6', 'Enter'], label: t.quiz },
];
