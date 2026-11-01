import { useEffect, useState } from 'react';
import { chat } from './strings';

/** Copies text, and says so in the label for a moment instead of with a toast. */
export function useCopy(text: string) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const copy = () => {
    const write = navigator.clipboard?.writeText(text);
    if (!write) return setState('failed');
    write.then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };

  const label = state === 'copied' ? chat.copied : state === 'failed' ? chat.copyFailed : chat.copy;
  return { copy, label, announced: state === 'idle' ? '' : label };
}
