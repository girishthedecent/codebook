import { z } from 'zod';
import prismaClient from '../../src/config/db.config.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { generateObject, type CallContext } from '../../src/llm/client.js';
import { textRoutes } from '../../src/llm/models.js';
import { judgeCorrectnessPrompt } from '../../src/llm/prompts/judgeCorrectness.js';
import { judgeGroundingPrompt } from '../../src/llm/prompts/judgeGrounding.js';
import type { PromptTemplate } from '../../src/llm/prompts/registry.js';
import { renderSource } from '../../src/modules/citations/citationRegistry.js';
import { sha256 } from '../../src/utils/hash.js';
import { countTokens } from '../../src/utils/tokens.js';
import type { JudgeInput, StoredPassage } from '../answer.types.js';

// The model-graded metrics (PLAN 14.2): correctness against the reference answer, and
// grounding (claims and citations against the cited passages). Every verdict is cached by
// the exact prompt the judge was sent, so rescoring a stored run costs nothing.

export const JUDGE_CAPS = {
  // One cited passage as the judge sees it; longer ones are cut. Parent blocks go up to
  // ~1,500 tokens, so a cited parent arrives whole.
  passageTokens: 1_600,
  // The whole grounding prompt: a multi-hop answer citing six parents fits. Past this the
  // case isn't grounded-judged: a cut answer or a dropped passage would turn into false
  // "unsupported" verdicts.
  inputTokens: 20_000,
};

const GRADES = { correct: 1, partial: 0.5, wrong: 0 } as const;

const correctnessSchema = z.object({
  grade: z.enum(['correct', 'partial', 'wrong']),
  declined: z.boolean(),
  reason: z.string(),
});

const groundingSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string(),
      cited: z.array(z.int()),
      supported: z.boolean(),
      reason: z.string(),
    }),
  ),
  citations: z.array(z.object({ n: z.int(), supports: z.boolean(), reason: z.string() })),
});

export type Correctness = { score: number; declined: boolean; reason: string; cached: boolean };
export type Grounding = z.infer<typeof groundingSchema> & { cached: boolean };

/** The judge as runs record it, e.g. google/gemini-3.5-flash-lite. */
export function judgeModel() {
  const { provider, model } = textRoutes.judge.primary;
  return `${provider}/${model}`;
}

/**
 * How an answer model relates to a judge, both as provider/model (a bare model id is taken
 * as the same model when the judge's id ends with it, with an unknown provider).
 */
export function judgeRelation(answerModel: string | null, judge: string) {
  if (answerModel === null) return { selfJudged: false, sameProvider: false };
  const selfJudged = answerModel === judge || judge.endsWith(`/${answerModel}`);
  const provider = (id: string) => (id.includes('/') ? id.slice(0, id.indexOf('/')) : null);
  const answerProvider = provider(answerModel);
  return {
    selfJudged,
    sameProvider: selfJudged || (answerProvider !== null && answerProvider === provider(judge)),
  };
}

/** A judge call whose verdict is kept in EvalJudgeCache under the exact prompt sent. */
async function judgement<T>(
  prompt: PromptTemplate,
  text: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  ctx?: CallContext,
): Promise<{ value: T; cached: boolean }> {
  const model = judgeModel();
  const key = sha256(prompt.id, model, text);
  const hit = await prismaClient.evalJudgeCache.findUnique({ where: { key } });
  if (hit) {
    const parsed = schema.safeParse(hit.value);
    if (parsed.success) return { value: parsed.data, cached: true };
  }
  const { object } = await generateObject({
    task: 'judge',
    schema,
    prompt: text,
    abortSignal: signal,
    ctx,
  });
  await prismaClient.evalJudgeCache.upsert({
    where: { key },
    create: { key, judge: `${prompt.id} ${model}`, value: object as Prisma.InputJsonValue },
    update: { value: object as Prisma.InputJsonValue },
  });
  return { value: object, cached: false };
}

export async function judgeCorrectness(
  input: Pick<JudgeInput, 'question' | 'expectedAnswer' | 'answer'>,
  signal?: AbortSignal,
  ctx?: CallContext,
): Promise<Correctness> {
  const text = judgeCorrectnessPrompt.render({
    question: input.question,
    expectedAnswer: input.expectedAnswer,
    answer: input.answer,
  });
  const { value, cached } = await judgement(
    judgeCorrectnessPrompt,
    text,
    correctnessSchema,
    signal,
    ctx,
  );
  return { score: GRADES[value.grade], declined: value.declined, reason: value.reason, cached };
}

/** The citation numbers the answer uses that point at a passage it was shown. */
export function validCited(input: Pick<JudgeInput, 'citations'>) {
  return [...new Set(input.citations.filter((c) => c.valid).map((c) => c.n))].sort((a, b) => a - b);
}

function capped(text: string, tokens: number) {
  const total = countTokens(text);
  if (total <= tokens) return text;
  // Cut by the share of characters, a little under, then mark the cut.
  return `${text.slice(0, Math.floor((text.length * tokens * 0.95) / total))}…`;
}

/** The grounding prompt for an answer, or why it can't be judged within the caps. */
export function groundingPrompt(input: Pick<JudgeInput, 'answer' | 'citations' | 'passages'>) {
  const cited = new Set(validCited(input));
  const passages = input.passages
    .filter((passage: StoredPassage) => cited.has(passage.n))
    .map((passage) => renderSource(passage, capped(passage.text, JUDGE_CAPS.passageTokens)));
  const text = judgeGroundingPrompt.render({
    passages: passages.join('\n\n') || '(none)',
    answer: input.answer,
  });
  const tokens = countTokens(text);
  if (tokens > JUDGE_CAPS.inputTokens) {
    return {
      text: null,
      skip: `grounding input is ${tokens} tokens, over ${JUDGE_CAPS.inputTokens}`,
    };
  }
  return { text, skip: null };
}

export async function judgeGrounding(
  text: string,
  signal?: AbortSignal,
  ctx?: CallContext,
): Promise<Grounding> {
  const { value, cached } = await judgement(
    judgeGroundingPrompt,
    text,
    groundingSchema,
    signal,
    ctx,
  );
  return { ...value, cached };
}

// Ways an answer says the sources don't cover the question. Only used when the judge didn't
// run, and only on the opening of the answer, where a refusal comes.
const DECLINE =
  /\b(not (covered|mentioned|discussed|described|addressed|included|found)|(don't|do not|doesn't|does not|can't|cannot|couldn't|could not) (cover|mention|discuss|describe|address|find|say|contain|answer)|no (information|mention|details?) (about|on|of)|not enough information|isn't in|aren't in|is not in|are not in)\b/i;

export function declinedByPhrase(answer: string) {
  return DECLINE.test(answer.slice(0, 400));
}
