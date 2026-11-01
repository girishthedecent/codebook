import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { Citation } from '@/api/types';
import { viewerSearchFor } from '@/lib/viewerParams';
import { citationDestination } from './citationTarget';

/** Opens a citation where it points: the viewer (the address keeps the registry number) or an outside page. */
export function useOpenCitation(messageId?: string) {
  const navigate = useNavigate();
  return useCallback(
    (citation: Citation) => {
      const dest = citationDestination(citation);
      if (dest.kind === 'viewer') {
        void navigate({
          to: '.',
          search: (s: Record<string, unknown>) => ({
            ...s,
            ...viewerSearchFor(dest.target, citation.n, messageId),
          }),
        });
      } else if (dest.kind === 'external') {
        window.open(dest.url, '_blank', 'noopener,noreferrer');
      }
    },
    [navigate, messageId],
  );
}
