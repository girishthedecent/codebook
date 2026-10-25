import { useEffect } from 'react';
import { useBlocker } from '@tanstack/react-router';

/**
 * Warns before leaving a page that holds edits nobody has saved: the browser's own prompt on
 * reload or close, and a confirm for in-app navigation. Pass `dirty` as false once saved.
 */
export function useUnsavedChanges(dirty: boolean, message = 'Leave without saving your changes?') {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm(message),
    enableBeforeUnload: false,
    disabled: !dirty,
  });
}
