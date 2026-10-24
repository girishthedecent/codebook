import { appConfig } from '../../config/app.config.js';
import type {
  FlashcardsData,
  FlashcardsOutput,
  MindmapData,
  MindmapNode,
  MindmapOutput,
  QuizData,
  QuizOutput,
  SummaryData,
  SummaryOutput,
} from './study.schemas.js';

// Turns the model's output into what is stored, or says what is wrong with it so the
// retry can fix it. Citation numbers that point at no source are dropped; an item left
// with none is kept but flagged `uncited`.

export type Checked<T> = { data: T; errors?: never } | { data?: never; errors: string[] };

type HasSource = (n: number) => boolean;

function cited(numbers: number[], has: HasSource) {
  const citations = [...new Set(numbers)].filter(has);
  return citations.length > 0 ? { citations } : { citations, uncited: true as const };
}

const normalized = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

export function checkQuiz(output: QuizOutput, count: number, has: HasSource): Checked<QuizData> {
  const errors: string[] = [];
  const seen = new Set<string>();
  output.questions.forEach((q, i) => {
    const label = `Question ${i + 1}`;
    if (!q.question.trim()) errors.push(`${label} is empty.`);
    if (q.options.length !== 4) {
      errors.push(`${label} has ${q.options.length} options; it needs exactly 4.`);
    } else if (new Set(q.options.map(normalized)).size !== 4) {
      errors.push(`${label} repeats an option; the 4 options must be different.`);
    }
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) {
      errors.push(`${label} has answerIndex ${q.answerIndex}; it must be 0, 1, 2 or 3.`);
    }
    const key = normalized(q.question);
    if (seen.has(key)) errors.push(`${label} repeats an earlier question.`);
    seen.add(key);
  });
  if (output.questions.length === 0) errors.push('The quiz has no questions.');
  if (errors.length > 0) return { errors };

  return {
    data: {
      title: output.title.trim(),
      questions: output.questions.slice(0, count).map((q, i) => ({
        id: `q${i + 1}`,
        question: q.question.trim(),
        options: q.options.map((option) => option.trim()),
        answerIndex: q.answerIndex,
        explanation: q.explanation.trim(),
        difficulty: q.difficulty,
        ...cited(q.citations, has),
      })),
    },
  };
}

export function checkFlashcards(
  output: FlashcardsOutput,
  count: number,
  has: HasSource,
): Checked<FlashcardsData> {
  const seen = new Set<string>();
  const cards = output.cards.filter((card) => {
    const key = normalized(card.front);
    if (!key || !card.back.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (cards.length === 0) return { errors: ['There are no cards with both a front and a back.'] };

  return {
    data: {
      title: output.title.trim(),
      cards: cards.slice(0, count).map((card, i) => ({
        id: `c${i + 1}`,
        front: card.front.trim(),
        back: card.back.trim(),
        ...cited(card.citations, has),
      })),
    },
  };
}

/**
 * Builds the tree from the flat node list. Nodes under the depth limit or past the node
 * limit (breadth first) are left out, as are nodes that don't hang off the root.
 */
export function checkMindmap(output: MindmapOutput, has: HasSource): Checked<MindmapData> {
  const { maxNodes, maxDepth } = appConfig.study.mindmap;
  const roots = output.nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) {
    return {
      errors: [`The map has ${roots.length} root nodes (parentId null); it needs exactly 1.`],
    };
  }

  const children = new Map<string, MindmapOutput['nodes']>();
  for (const node of output.nodes) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const toNode = (node: MindmapOutput['nodes'][number]): MindmapNode => ({
    id: node.id,
    label: node.label.trim(),
    children: [],
    ...cited(node.citations, has),
  });
  const root = toNode(roots[0]!);
  // Breadth first, so the node limit cuts the deepest details, not whole branches.
  const queue: { source: MindmapOutput['nodes'][number]; node: MindmapNode; depth: number }[] = [
    { source: roots[0]!, node: root, depth: 0 },
  ];
  const visited = new Set([roots[0]!.id]);
  let total = 1;
  while (queue.length > 0) {
    const { source, node, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    for (const child of children.get(source.id) ?? []) {
      if (visited.has(child.id) || total >= maxNodes || !child.label.trim()) continue;
      visited.add(child.id);
      const built = toNode(child);
      node.children.push(built);
      total += 1;
      queue.push({ source: child, node: built, depth: depth + 1 });
    }
  }
  if (root.children.length === 0) return { errors: ['The root node has no children.'] };
  return { data: { title: output.title.trim(), root } };
}

export function checkSummary(output: SummaryOutput, has: HasSource): Checked<SummaryData> {
  const sections = output.sections
    .map((section) => ({
      heading: section.heading.trim(),
      bullets: section.bullets
        .filter((bullet) => bullet.text.trim())
        .map((bullet) => ({ text: bullet.text.trim(), ...cited(bullet.citations, has) })),
    }))
    .filter((section) => section.bullets.length > 0);
  if (sections.length === 0) return { errors: ['The summary has no sections with bullets.'] };

  return {
    data: {
      title: output.title.trim(),
      sections,
      keyTerms: output.keyTerms
        .filter((term) => term.term.trim() && term.definition.trim())
        .map((term) => ({
          term: term.term.trim(),
          definition: term.definition.trim(),
          ...cited(term.citations, has),
        })),
    },
  };
}
