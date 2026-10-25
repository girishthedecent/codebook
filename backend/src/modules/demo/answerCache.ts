import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';
import logger from '../../config/logger.config.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { DEFAULT_AGENT_PROMPT } from '../../llm/prompts/agentSystem.js';
import { sha256 } from '../../utils/hash.js';
import type { CheckedCitation } from '../citations/citations.types.js';

// Demo visitors mostly ask the same few questions. The first question of a demo
// conversation is answered once and the answer kept for a day, so repeats cost no model
// calls. Only answers that depend on nothing but the question and the sources are kept:
// no history, no memory, no web results.

export type CachedAnswer = {
  content: string;
  citations: CheckedCitation[];
  model: string | null;
  promptId: string;
};

type CacheableTurn = {
  workspace: { id: string; isDemo: boolean };
  conversation: { id: string };
  questionId: string;
  question: string;
  isSystem: boolean;
};

/** Case, spacing and the closing "?" don't change what is asked. */
export function normalizeQuestion(question: string) {
  return question
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\p{P}\s]+$/u, '');
}

/**
 * The cache key for this turn's answer, or null when the answer can't be shared: outside
 * the demo, with memory on, for the eval user, or after the first question of a
 * conversation (a follow-up depends on the turns before it).
 */
export async function answerCacheKey(turn: CacheableTurn, useMemory: boolean) {
  if (!turn.workspace.isDemo || turn.isSystem || useMemory) return null;
  const earlier = await prismaClient.message.count({
    where: { conversationId: turn.conversation.id, id: { not: turn.questionId } },
  });
  if (earlier > 0) return null;

  // A source added, removed or ingested again changes what the answer would cite.
  const sources = await prismaClient.source.findMany({
    where: { workspaceId: turn.workspace.id },
    select: { id: true, lastIngestedAt: true },
    orderBy: { id: 'asc' },
  });
  const contentVersion = sources
    .map((source) => `${source.id}@${source.lastIngestedAt?.toISOString() ?? '-'}`)
    .join(',');
  return sha256(
    turn.workspace.id,
    normalizeQuestion(turn.question),
    DEFAULT_AGENT_PROMPT,
    contentVersion,
  );
}

const ttlCutoff = (now = Date.now()) => new Date(now - appConfig.demo.answerCacheTtlSec * 1000);

export async function findCachedAnswer(key: string): Promise<CachedAnswer | null> {
  const row = await prismaClient.answerCache.findFirst({
    where: { key, createdAt: { gte: ttlCutoff() } },
  });
  if (!row) return null;
  return {
    content: row.content,
    citations: row.citations as unknown as CheckedCitation[],
    model: row.model,
    promptId: row.promptId,
  };
}

const COPY_WINDOW = 200;
const COPY_STEP = 50;

/**
 * Does the answer repeat a passage word for word over a long stretch (about 250 characters
 * or more)? Such an answer is copying the book, and must not be handed to every visitor.
 */
export function copiesPassage(answer: string, passages: readonly string[]) {
  const flat = (text: string) => text.replace(/\s+/g, ' ');
  const text = flat(answer);
  if (text.length < COPY_WINDOW) return false;
  const sources = passages.map(flat);
  for (let start = 0; start + COPY_WINDOW <= text.length; start += COPY_STEP) {
    const window = text.slice(start, start + COPY_WINDOW);
    if (sources.some((source) => source.includes(window))) return true;
  }
  return false;
}

/**
 * Keeps a finished answer when every citation in it checked out, none is a web page (those
 * can change) and it doesn't copy a passage at length. Two visitors asking at once both
 * store; the later one wins.
 */
export async function storeCachedAnswer(
  key: string,
  workspaceId: string,
  answer: CachedAnswer & { invalidCitations: number; passages: readonly string[] },
) {
  const { citations } = answer;
  const shareable =
    answer.invalidCitations === 0 &&
    citations.length > 0 &&
    citations.every((citation) => citation.valid && citation.kind !== 'WEB') &&
    !copiesPassage(answer.content, answer.passages);
  if (!shareable) return false;

  const data = {
    content: answer.content,
    citations: citations as unknown as Prisma.InputJsonValue,
    model: answer.model,
    promptId: answer.promptId,
    createdAt: new Date(),
  };
  try {
    await prismaClient.answerCache.upsert({
      where: { key },
      create: { key, workspaceId, ...data },
      update: data,
    });
    return true;
  } catch (error) {
    // The answer is saved and streamed already; only the next visitor's shortcut is lost.
    logger.warn('Could not cache the demo answer', { error, workspaceId });
    return false;
  }
}

/** Deletes the answers older than the TTL; the daily guest cleanup calls this. */
export async function deleteExpiredAnswers(now = Date.now()) {
  const { count } = await prismaClient.answerCache.deleteMany({
    where: { createdAt: { lt: ttlCutoff(now) } },
  });
  return count;
}
