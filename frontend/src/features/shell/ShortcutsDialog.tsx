import { useEffect, useState } from 'react';
import { Dialog, Kbd } from '@/ui';
import { useShortcut } from '@/lib/keyboard';
import { shortcutRows } from '@/features/settings/shortcuts';
import { shellStrings } from './strings';

const OPEN_EVENT = 'codebook:open-shortcuts';

/** Opens the list of keyboard shortcuts from anywhere, e.g. a command in the ⌘K menu. */
export function openShortcuts() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** `?` shows what the keyboard does. Mounted once by the frame; typing a `?` in a field doesn't open it. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useShortcut('?', () => setOpen((o) => !o));
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={shellStrings.shortcuts.title}
      description={shellStrings.shortcuts.description}
      size="sm"
    >
      <dl className="flex flex-col gap-2.5">
        {shortcutRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <dt className="text-ink-2">{row.label}</dt>
            <dd className="m-0 flex shrink-0 gap-1">
              {row.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
