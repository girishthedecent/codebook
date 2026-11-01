import { useState } from 'react';
import type { Message } from '@/api/types';
import { useMessageFeedback } from '@/api/queries/conversations';
import { Button } from '@/ui';
import { cn } from '@/lib/cn';
import { chat } from './strings';
import { useCopy } from './useCopy';

/** "Helpful" / "Not helpful" as two quiet buttons. The choice can be changed, not cleared. */
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
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={current === v}
      onClick={() => pick(v)}
      className={cn(current === v && 'bg-accent-wash')}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Was this answer helpful?">
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
  const { copy, label, announced } = useCopy(text);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={copy}>
        {label}
      </Button>
      <span role="status" className="sr-only">
        {announced}
      </span>
    </>
  );
}
