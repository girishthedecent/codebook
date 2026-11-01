import type { Citation, SourceType } from '../../api/types';

// The shapes of the JSON files in ./fixtures. scripts/capture-demo.ts writes them from the live
// demo; the landing page reads them and hides any section whose file is missing.

/** What a source in the demo holds: only the counts the page quotes. */
export type DemoSource = {
  type: SourceType;
  title: string;
  /** Where the source lives, when it has a public address. */
  href?: string;
  /** Plain counts, e.g. { pages: 189, chunks: 148 } or { files: 22, symbols: 43 }. */
  counts: Record<string, number>;
};

export type DemoFixture = {
  capturedAt: string;
  workspaceName: string;
  starterQuestions: string[];
  sources: DemoSource[];
};

/** One tool call of the agent, with when it started and how long it took (ms into the turn). */
export type TurnStep = {
  tool: string;
  args?: unknown;
  /** A short description of what the call did, when the server wrote one. */
  summary?: string;
  startAt: number;
  ms?: number;
  ok?: boolean;
};

/** A run of the answer text that arrived together, `at` ms into the turn. */
export type TurnChunk = { at: number; text: string };

export type TurnFixture = {
  capturedAt: string;
  question: string;
  steps: TurnStep[];
  chunks: TurnChunk[];
  answer: string;
  citations: Citation[];
  latencyMs: number;
};

/** A box on a page as fractions of its width and height, from the top left. */
export type Rect = { x: number; y: number; w: number; h: number };

export type BookPage = {
  page: number;
  image: string;
  width: number;
  height: number;
  /** Where each citation (by number) sits on this page. */
  marks: Array<{ n: number; rects: Rect[] }>;
};

export type BookFixture = {
  title: string;
  credit: string;
  pages: BookPage[];
};

/** A piece of code: its text and a short class for colouring ('' for plain text). */
export type CodeToken = [text: string, kind: string];

export type CodeSlice = {
  path: string;
  lineStart: number;
  lineEnd: number;
  lines: CodeToken[][];
};

export type CodeFixture = {
  repo: string;
  ref: string;
  href: string;
  credit: string;
  slices: CodeSlice[];
};

export type GraphNode = {
  id: string;
  name: string;
  kind: string;
  path: string;
  line: number;
};

export type GraphFixture = {
  repo: string;
  nodes: GraphNode[];
  /** Caller id, callee id. */
  edges: Array<[string, string]>;
  /** A pair the page offers to trace first. */
  featured?: [string, string];
};

export type StudyFixture = {
  flashcard?: {
    front: string;
    back: string;
    citation?: Citation;
  };
  quiz?: {
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
    citation?: Citation;
  };
};
