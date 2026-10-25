import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { conversationQueryOptions } from '@/api/queries';
import type { Citation } from '@/api/types';
import { citationDestination } from '@/features/citations/citationTarget';
import type { ViewerTarget } from '@/lib/viewerParams';

export type CitationStop = { citation: Citation; target: ViewerTarget };

/**
 * The citations `[` and `]` step through: those of the answer whose chip is lit, in number
 * order, keeping only the ones that open in the viewer. Outside a conversation there are none.
 */
export function useCitationNav(cite: number | undefined) {
  const { conversationId } = useParams({ strict: false }) as { conversationId?: string };
  const conversation = useQuery({
    ...conversationQueryOptions(conversationId ?? ''),
    enabled: Boolean(conversationId),
  });

  return useMemo(() => {
    const messages = conversation.data?.messages.items ?? [];
    const answers = messages
      .filter((m) => m.role === 'ASSISTANT' && m.citations.length)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // Numbers restart every turn, so prefer the latest answer that has the lit number.
    const answer =
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
  }, [conversation.data, cite]);
}
