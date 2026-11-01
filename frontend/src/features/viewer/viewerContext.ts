import { createContext, use } from 'react';
import type { Highlight } from '@/api/types';

export type ViewerContextValue = {
  /** What the find bar is looking for and which hit is current; unset while it is closed. */
  find?: { query: string; index: number };
  /** Each view says how many hits it found in what it shows. */
  setFindCount: (count: number) => void;
  /** True when the view searched only part of what it holds (a long file, loaded in windows). */
  setFindPartial: (partial: boolean) => void;
  /** The reader's highlights in the open source. */
  highlights: Highlight[];
};

export const ViewerContext = createContext<ViewerContextValue>({
  setFindCount: () => {},
  setFindPartial: () => {},
  highlights: [],
});

export const useViewerContext = () => use(ViewerContext);
