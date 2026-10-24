import { z } from 'zod';

// What the model is asked to return, per study type. The schemas are loose on purpose
// (any number of options, any answerIndex): a structured-output failure only says "didn't
// match", while study.validate.ts can tell the model exactly what to fix on the retry.

const citations = z.array(z.int()).describe('n of every <source> this item comes from');

export const quizOutput = z.object({
  title: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      answerIndex: z.int(),
      explanation: z.string(),
      citations,
      difficulty: z.enum(['easy', 'medium', 'hard']),
    }),
  ),
});

export const flashcardsOutput = z.object({
  title: z.string(),
  cards: z.array(z.object({ front: z.string(), back: z.string(), citations })),
});

// A flat list with parent ids: structured output handles recursive schemas poorly, so the
// tree is built after validation.
export const mindmapOutput = z.object({
  title: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      parentId: z.string().nullable(),
      label: z.string(),
      citations,
    }),
  ),
});

export const summaryOutput = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      bullets: z.array(z.object({ text: z.string(), citations })),
    }),
  ),
  keyTerms: z.array(z.object({ term: z.string(), definition: z.string(), citations })),
});

export type QuizOutput = z.infer<typeof quizOutput>;
export type FlashcardsOutput = z.infer<typeof flashcardsOutput>;
export type MindmapOutput = z.infer<typeof mindmapOutput>;
export type SummaryOutput = z.infer<typeof summaryOutput>;

// What is stored in StudyArtifact.data. Items whose citations all pointed nowhere are kept
// but flagged `uncited`.

type Cited = { citations: number[]; uncited?: true };

export type QuizData = {
  title: string;
  questions: (Cited & {
    id: string;
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
    difficulty: 'easy' | 'medium' | 'hard';
  })[];
};

export type FlashcardsData = {
  title: string;
  cards: (Cited & { id: string; front: string; back: string })[];
};

export type MindmapNode = Cited & { id: string; label: string; children: MindmapNode[] };
export type MindmapData = { title: string; root: MindmapNode };

export type SummaryData = {
  title: string;
  sections: { heading: string; bullets: (Cited & { text: string })[] }[];
  keyTerms: (Cited & { term: string; definition: string })[];
};

export type StudyData = QuizData | FlashcardsData | MindmapData | SummaryData;
