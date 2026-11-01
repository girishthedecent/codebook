import { useState } from 'react';
import type { Citation, Message } from '@/api/types';
import { useMessageFeedback } from '@/api/queries/conversations';
import { Button } from '@/ui';
import { cn } from '@/lib/cn';
import { citationCaption } from '@/features/citations/citationTarget';
import { numberCitations } from '@/features/citations/numbering';
import { citationStrings } from '@/features/citations/strings';
import { renumberMarkers } from './markers';
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

/** The answer with its markers numbered as the reader sees them, then the notes they point to. */
function withNotes(text: string, citations: Citation[]) {
  const { numbers, notes } = numberCitations(text, citations);
  const body = renumberMarkers(text, numbers).trimEnd();
  if (notes.length === 0) return body;
  const lines = notes.map(({ citation, shown }) => `[${shown}] ${citationCaption(citation)}`);
  return `${body}\n\n${citationStrings.notes}\n${lines.join('\n')}`;
}

/** Copies an answer's text and its notes. Says so in place for a moment instead of a toast. */
export function CopyAnswer({ text, citations }: { text: string; citations: Citation[] }) {
  const { copy, label, announced } = useCopy(withNotes(text, citations));
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
