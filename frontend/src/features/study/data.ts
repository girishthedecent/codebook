import type { Citation, StudyDetail } from '@/api/types';

// What GET /study/:id puts in `data`, per type (backend study.schemas.ts). The OpenAPI document
// types it as unknown, so the shapes are restated here and checked loosely before use.

type Cited = { citations: number[]; uncited?: true };

export type QuizQuestion = Cited & {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
};
export type QuizData = { title: string; questions: QuizQuestion[] };

export type Flashcard = Cited & { id: string; front: string; back: string };
export type FlashcardsData = { title: string; cards: Flashcard[] };

export type MindmapNode = Cited & { id: string; label: string; children: MindmapNode[] };
export type MindmapData = { title: string; root: MindmapNode };

export type SummaryData = {
  title: string;
  sections: { heading: string; bullets: (Cited & { text: string })[] }[];
  keyTerms: (Cited & { term: string; definition: string })[];
};

export type StudyContent =
  | { type: 'QUIZ'; data: QuizData }
  | { type: 'FLASHCARDS'; data: FlashcardsData }
  | { type: 'MINDMAP'; data: MindmapData }
  | { type: 'SUMMARY'; data: SummaryData };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The artifact's content with its type, or undefined when it isn't there (yet) or is malformed. */
export function studyContent(study: StudyDetail): StudyContent | undefined {
  const d = study.data;
  if (!isObject(d)) return undefined;
  switch (study.type) {
    case 'QUIZ':
      return Array.isArray(d.questions) ? { type: 'QUIZ', data: d as QuizData } : undefined;
    case 'FLASHCARDS':
      return Array.isArray(d.cards) ? { type: 'FLASHCARDS', data: d as FlashcardsData } : undefined;
    case 'MINDMAP':
      return isObject(d.root) ? { type: 'MINDMAP', data: d as MindmapData } : undefined;
    case 'SUMMARY':
      return Array.isArray(d.sections) ? { type: 'SUMMARY', data: d as SummaryData } : undefined;
  }
}

export function itemCount(content: StudyContent): number {
  switch (content.type) {
    case 'QUIZ':
      return content.data.questions.length;
    case 'FLASHCARDS':
      return content.data.cards.length;
    case 'MINDMAP':
      return countNodes(content.data.root);
    case 'SUMMARY':
      return content.data.sections.length;
  }
}

function countNodes(node: MindmapNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/**
 * Study sets keep their own list of what each citation number points at; these are the same
 * fields a chat citation has, minus the answer check. They are all resolved references, so
 * they count as valid; `supported` is a chat-only check.
 */
export function citationIndex(study: StudyDetail): Map<number, Citation> {
  return new Map(
    study.sources.map((src) => [
      src.n,
      { ...src, valid: true, supported: null } satisfies Citation,
    ]),
  );
}

export function citationsOf(item: Cited, index: Map<number, Citation>): Citation[] {
  return item.citations.flatMap((n) => {
    const c = index.get(n);
    return c ? [c] : [];
  });
}
