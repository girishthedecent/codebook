import { NoObjectGeneratedError } from 'ai';
import { appConfig } from '../../config/app.config.js';
import type { StudyType } from '../../generated/prisma/enums.js';
import { generate, generateObject, type CallContext } from '../../llm/client.js';
import { studyCondensePrompt } from '../../llm/prompts/studyCondense.js';
import { studyFlashcardsPrompt } from '../../llm/prompts/studyFlashcards.js';
import { studyMindmapPrompt } from '../../llm/prompts/studyMindmap.js';
import { studyQuizPrompt } from '../../llm/prompts/studyQuiz.js';
import { studySummaryPrompt } from '../../llm/prompts/studySummary.js';
import { UpstreamError } from '../../utils/errors/app.error.js';
import type { CitationRef } from '../citations/citations.types.js';
import type { StudyInput } from './study.dto.js';
import { renderGroup } from './study.gather.js';
import {
  flashcardsOutput,
  mindmapOutput,
  quizOutput,
  summaryOutput,
  type StudyData,
} from './study.schemas.js';
import {
  checkFlashcards,
  checkMindmap,
  checkQuiz,
  checkSummary,
  type Checked,
} from './study.validate.js';

export const promptFor = {
  QUIZ: studyQuizPrompt,
  FLASHCARDS: studyFlashcardsPrompt,
  MINDMAP: studyMindmapPrompt,
  SUMMARY: studySummaryPrompt,
} as const;

export const LABELS: Record<StudyType, string> = {
  QUIZ: 'quiz',
  FLASHCARDS: 'flashcards',
  MINDMAP: 'mind map',
  SUMMARY: 'summary',
};

/** How many items a quiz or deck asks for when the request didn't say. */
export function defaultCount(type: StudyType) {
  if (type === 'QUIZ') return appConfig.study.quiz.default;
  if (type === 'FLASHCARDS') return appConfig.study.flashcards.default;
  return undefined;
}

/** One group of passages as condensed notes that still cite the original numbers. */
export async function condenseGroup(refs: CitationRef[], groups: number, ctx: CallContext) {
  const maxWords = Math.min(
    1_200,
    Math.floor((appConfig.study.maxInputTokens * 0.7) / groups / 1.4),
  );
  const { text } = await generate({
    task: 'summarize',
    prompt: studyCondensePrompt.render({ maxWords: String(maxWords), sources: renderGroup(refs) }),
    ctx,
  });
  const numbers = refs.map((ref) => ref.n).join(', ');
  return `<notes sources="${numbers}">\n${text.trim()}\n</notes>`;
}

type Generated = Checked<StudyData> & { model?: string };

/**
 * One generation over the material. Output that fails the checks comes back as `errors`,
 * which the caller feeds into the second (and last) attempt; so does output that wasn't
 * valid for the schema. Any other model failure is thrown.
 */
export async function generateStudy(
  type: StudyType,
  input: StudyInput,
  material: string,
  cited: number[],
  ctx: CallContext,
  feedback?: string[],
): Promise<Generated> {
  const known = new Set(cited);
  const has = (n: number) => known.has(n);
  const count = input.count ?? defaultCount(type) ?? 0;
  let prompt = render(type, { count, difficulty: input.difficulty, sources: material });
  if (feedback) {
    prompt += `\n\nYour previous answer was rejected:\n${feedback.map((e) => `- ${e}`).join('\n')}\nWrite it again with these problems fixed.`;
  }

  const call = { task: 'study' as const, prompt, ctx };
  try {
    switch (type) {
      case 'QUIZ': {
        const { object, call: info } = await generateObject({ ...call, schema: quizOutput });
        return { ...checkQuiz(object, count, has), model: info.model };
      }
      case 'FLASHCARDS': {
        const { object, call: info } = await generateObject({ ...call, schema: flashcardsOutput });
        return { ...checkFlashcards(object, count, has), model: info.model };
      }
      case 'MINDMAP': {
        const { object, call: info } = await generateObject({ ...call, schema: mindmapOutput });
        return { ...checkMindmap(object, has), model: info.model };
      }
      case 'SUMMARY': {
        const { object, call: info } = await generateObject({ ...call, schema: summaryOutput });
        return { ...checkSummary(object, has), model: info.model };
      }
    }
  } catch (error) {
    // Output that didn't fit the schema is the model's mistake, handled like a failed check.
    // Anything else (quota, timeout, provider down) is rethrown so the step is retried.
    if (error instanceof UpstreamError && NoObjectGeneratedError.isInstance(error.cause)) {
      return { errors: ["The answer wasn't valid JSON for the required schema."] };
    }
    throw error;
  }
}

function render(type: StudyType, vars: { count: number; difficulty: string; sources: string }) {
  const { sources } = vars;
  switch (type) {
    case 'QUIZ':
    case 'FLASHCARDS':
      return promptFor[type].render({
        count: String(vars.count),
        difficulty: vars.difficulty,
        sources,
      });
    case 'MINDMAP':
      return promptFor.MINDMAP.render({
        maxNodes: String(appConfig.study.mindmap.maxNodes),
        maxDepth: String(appConfig.study.mindmap.maxDepth),
        sources,
      });
    case 'SUMMARY':
      return promptFor.SUMMARY.render({ sources });
  }
}

/** Every citation number used anywhere in the stored data. */
export function citedNumbers(data: unknown, found = new Set<number>()) {
  if (Array.isArray(data)) {
    for (const item of data) citedNumbers(item, found);
  } else if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (key === 'citations' && Array.isArray(value)) {
        for (const n of value) if (typeof n === 'number') found.add(n);
      } else {
        citedNumbers(value, found);
      }
    }
  }
  return found;
}
