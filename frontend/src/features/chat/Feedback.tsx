import { useEffect, useState } from 'react';
import type { Message } from '@/api/types';
import { useMessageFeedback } from '@/api/queries/conversations';
import { cn } from '@/lib/cn';
import { chat } from './strings';

/** "Helpful" / "Not helpful" as two plain text buttons. The choice can be changed, not cleared. */
export function Feedback({
  conversationId,
  messageId,
  value,
}: {
  conversationId: string;
  messageId: string;
  value: Message['feedback'];
}) {
  const feedback = useMessageFeedback(conversationId);
  // Shown at once; the saved value catches up when the conversation refetches.
  const [chosen, setChosen] = useState<Message['feedback']>(value);
  const current = chosen ?? value;

  const [note, setNote] = useState('');

  const pick = (v: 'UP' | 'DOWN') => {
    setChosen(v);
    setNote(chat.thanks);
    feedback.mutate(
      { messageId, value: v },
      {
        onError: () => {
          setChosen(value);
          setNote(chat.feedbackFailed);
        },
      },
    );
  };

  const button = (v: 'UP' | 'DOWN', label: string) => (
    <button
      type="button"
      aria-pressed={current === v}
      onClick={() => pick(v)}
      className={cn(
        'text-xs text-ink-3 hover:text-ink max-[719px]:min-h-11',
        current === v && 'font-medium text-accent hover:text-accent',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-3" role="group" aria-label="Was this answer helpful?">
      {button('UP', chat.helpful)}
      {button('DOWN', chat.notHelpful)}
      <span role="status" className="text-xs text-ink-3">
        {note}
      </span>
    </div>
  );
}

/** Copies an answer's text. Says so in place for a moment instead of a toast. */
export function CopyAnswer({ text }: { text: string }) {
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
  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="text-xs text-ink-3 hover:text-ink max-[719px]:min-h-11"
      >
        {label}
      </button>
      <span role="status" className="sr-only">
        {state === 'idle' ? '' : label}
      </span>
    </>
  );
}
