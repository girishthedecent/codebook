import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import type { Citation } from '@/api/types';
import { useMessages } from '@/features/chat/useMessages';
import { citationDestination } from '@/features/citations/citationTarget';
import type { ViewerTarget } from '@/lib/viewerParams';

export type CitationStop = { citation: Citation; target: ViewerTarget };

/**
 * The citations `[` and `]` step through: those of the answer whose chip is lit, in number
 * order, keeping only the ones that open in the viewer. Outside a conversation there are none.
 */
export function useCitationNav(cite: number | undefined, from: string | undefined) {
  const { conversationId } = useParams({ strict: false }) as { conversationId?: string };
  // The transcript's own query, so the newest answers are here even in a long conversation.
  const { messages } = useMessages(conversationId ?? '', Boolean(conversationId));

  return useMemo(() => {
    const answers = messages
      .filter((m) => m.role === 'ASSISTANT' && m.citations.length)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // Numbers restart every turn, so the message in the URL says which answer is meant.
    const answer =
      (from !== undefined && answers.find((m) => m.id === from)) ||
      (cite !== undefined && answers.find((m) => m.citations.some((c) => c.n === cite))) ||
      answers[0];

    const stops: CitationStop[] = [];
    for (const citation of [...(answer?.citations ?? [])].sort((a, b) => a.n - b.n)) {
      const dest = citationDestination(citation);
      if (dest.kind === 'viewer') stops.push({ citation, target: dest.target });
    }
    const index = stops.findIndex((stop) => stop.citation.n === cite);
    return {
      current: index >= 0 ? stops[index] : undefined,
      prev: index > 0 ? stops[index - 1] : undefined,
      next: index >= 0 && index < stops.length - 1 ? stops[index + 1] : undefined,
      hasStops: stops.length > 1 && index >= 0,
    };
  }, [messages, cite, from]);
}
