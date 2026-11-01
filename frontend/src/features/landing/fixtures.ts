import type {
  BookFixture,
  CodeFixture,
  DemoFixture,
  GraphFixture,
  StudyFixture,
  TurnFixture,
} from './fixtureTypes';

// The captured files, read at build time. A file that isn't there (or is too thin to show) is
// simply undefined, and the section that needs it is left out.
const files = import.meta.glob<unknown>('./fixtures/*.json', { eager: true, import: 'default' });

function load<T>(name: string): T | undefined {
  return files[`./fixtures/${name}.json`] as T | undefined;
}

const demo = load<DemoFixture>('demo');
const turn = load<TurnFixture>('turn');
const book = load<BookFixture>('book');
const code = load<CodeFixture>('code');
const graph = load<GraphFixture>('graph');
const study = load<StudyFixture>('study');

export const fixtures = {
  demo: demo && demo.starterQuestions.length > 0 ? demo : undefined,
  turn:
    turn && turn.answer && turn.citations.length > 0 && turn.steps.length > 0 ? turn : undefined,
  book: book?.pages.length ? book : undefined,
  code: code?.slices.length ? code : undefined,
  graph: graph && graph.nodes.length >= 4 && graph.edges.length >= 3 ? graph : undefined,
  study: study?.flashcard || study?.quiz ? study : undefined,
};
