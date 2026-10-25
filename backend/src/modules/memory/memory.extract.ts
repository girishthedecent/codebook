import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import logger from '../../config/logger.config.js';
import { MemoryKind } from '../../generated/prisma/enums.js';
import { generateObject } from '../../llm/client.js';
import { embedTexts } from '../../llm/embeddings.js';
import { memoryExtractPrompt } from '../../llm/prompts/memoryExtract.js';
import { sensitiveReason } from './memory.filter.js';
import {
  advanceMemoryWatermark,
  findAddedFrom,
  findTurnAnswer,
  hasLiveMemories,
  messagesForMemory,
  similarMemories,
  softDeleteMemory,
  updateMemory,
} from './memory.repository.js';
import { addMemory, cleanContent, embedMemory, ProfileFullError } from './memory.service.js';

const USER_CHARS = 1_500;
// Answers quote books, code and web pages; only enough of one to tell what the user meant.
const ANSWER_CHARS = 160;
const MAX_OPERATIONS = 8;

// Loose on purpose: ids and ranges are checked below, where a bad one only skips that op.
const extractOutput = z.object({
  operations: z.array(
    z.object({
      op: z.enum(['ADD', 'UPDATE', 'DELETE', 'NONE']),
      memoryId: z
        .string()
        .nullable()
        .describe('The id of an existing memory, for UPDATE and DELETE'),
      kind: z.enum(MemoryKind),
      content: z.string(),
      importance: z.int().describe('1 to 5'),
    }),
  ),
});

type Operation = z.infer<typeof extractOutput>['operations'][number];

type Mark = { conversationId: string; id: string; createdAt: string };

/**
 * What the model decided, with everything the apply step needs. Plain JSON: it is an
 * Inngest step result, so a retried apply reuses it instead of asking the model again.
 */
export type ExtractPlan =
  | { skipped: string; advance?: Mark }
  | {
      userId: string;
      answerId: string;
      // The memories the model was shown, by the label it saw.
      candidates: { label: string; id: string; content: string }[];
      operations: Operation[];
      advance: Mark;
    };

export type ExtractResult =
  | { skipped: string }
  | { added: number; updated: number; deleted: number; dropped: number; ignored: number };

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

// The messages sit inside <conversation>; a message must not be able to close it.
const neutralize = (text: string) => text.replace(/<(\/?)conversation\b/gi, '‹$1conversation');

const clampImportance = (value: number) => Math.min(5, Math.max(1, Math.round(value)));

/**
 * Reads what is new in the conversation since the last extraction (memory-off turns left
 * out), finds the user's memories closest to it, and asks the model for operations.
 */
export async function planExtraction(input: {
  conversationId: string;
  messageId: string;
}): Promise<ExtractPlan> {
  const answer = await findTurnAnswer(input.conversationId, input.messageId);
  if (!answer) return { skipped: 'the answer is gone' };
  const { userId, workspaceId, user, memoryUpToMessageId } = answer.conversation;
  if (user.isGuest || user.isSystem) return { skipped: 'guest or system user' };
  const advance = {
    conversationId: input.conversationId,
    id: answer.id,
    createdAt: answer.createdAt.toISOString(),
  };

  const messages = await messagesForMemory(
    input.conversationId,
    memoryUpToMessageId,
    answer,
    appConfig.memory.extractExchanges * 2,
  );
  const said = messages
    .filter((message) => message.role === 'USER')
    .map((message) => message.content)
    .join('\n');
  if (!said.trim()) return { skipped: 'nothing new from the user', advance };

  let found: { id: string; kind: MemoryKind; content: string }[] = [];
  if (await hasLiveMemories(userId)) {
    const [vector] = await embedTexts([cut(said, USER_CHARS * 2)], {
      kind: 'query',
      ctx: { userId, workspaceId },
    });
    found = await similarMemories(userId, vector!, appConfig.memory.extractCandidates);
  }
  // Short labels instead of database ids: the model copies them reliably, and an id it
  // wasn't shown can't be named at all.
  const candidates = found.map((memory, i) => ({ label: `m${i + 1}`, ...memory }));
  const listed =
    candidates.length === 0
      ? '(none)'
      : candidates
          .map((memory) => `- id=${memory.label} kind=${memory.kind}: ${memory.content}`)
          .join('\n');
  const conversation = messages
    .map((message) =>
      message.role === 'USER'
        ? `User: ${neutralize(cut(message.content, USER_CHARS))}`
        : `Assistant (excerpt): ${neutralize(cut(message.content, ANSWER_CHARS))}`,
    )
    .join('\n\n');

  const { object } = await generateObject({
    task: 'memory',
    prompt: memoryExtractPrompt.render({ memories: listed, conversation }),
    schema: extractOutput,
    ctx: { userId, workspaceId },
  });

  return {
    userId,
    answerId: answer.id,
    candidates: candidates.map(({ label, id, content }) => ({ label, id, content })),
    operations: object.operations.slice(0, MAX_OPERATIONS),
    advance,
  };
}

const markOf = (mark: Mark) => ({ id: mark.id, createdAt: new Date(mark.createdAt) });

/**
 * Applies a plan's operations, then moves the conversation's watermark past what it read.
 * An UPDATE or DELETE can only touch a memory the model was shown, anything that looks
 * like a secret or sensitive personal data is dropped, and running it twice adds nothing
 * new (a retried step).
 */
export async function applyExtraction(plan: ExtractPlan): Promise<ExtractResult> {
  if ('skipped' in plan) {
    if (plan.advance)
      await advanceMemoryWatermark(plan.advance.conversationId, markOf(plan.advance));
    return { skipped: plan.skipped };
  }
  const { userId, answerId } = plan;
  const byLabel = new Map(plan.candidates.map((memory) => [memory.label, memory]));
  const counts = { added: 0, updated: 0, deleted: 0, dropped: 0, ignored: 0 };
  const touched = new Set<string>();
  const known = new Set(plan.candidates.map((memory) => memory.content.toLowerCase()));

  for (const op of plan.operations) {
    if (op.op === 'NONE') continue;
    const content = cleanContent(op.content);
    const importance = clampImportance(op.importance);

    if (op.op !== 'DELETE') {
      if (!content) {
        counts.ignored += 1;
        continue;
      }
      const reason = sensitiveReason(content);
      if (reason) {
        logger.info('Memory dropped', { userId, rule: reason });
        counts.dropped += 1;
        continue;
      }
    }

    if (op.op === 'ADD') {
      if (known.has(content.toLowerCase()) || (await findAddedFrom(userId, answerId, content))) {
        counts.ignored += 1;
        continue;
      }
      known.add(content.toLowerCase());
      try {
        await addMemory(userId, { kind: op.kind, content, importance }, answerId);
        counts.added += 1;
      } catch (error) {
        if (!(error instanceof ProfileFullError)) throw error;
        counts.dropped += 1;
      }
      continue;
    }

    const target = op.memoryId ? byLabel.get(op.memoryId.trim()) : undefined;
    if (!target || touched.has(target.id)) {
      counts.ignored += 1;
      continue;
    }
    touched.add(target.id);
    if (op.op === 'DELETE') {
      if (await softDeleteMemory(userId, target.id)) counts.deleted += 1;
      continue;
    }
    const changed = content !== target.content;
    const embedding = changed ? await embedMemory(userId, content) : undefined;
    const updated = await updateMemory(
      userId,
      target.id,
      { content: changed ? content : undefined, importance, sourceMessageId: answerId },
      embedding,
    );
    if (updated) {
      known.add(content.toLowerCase());
      counts.updated += 1;
    }
  }

  await advanceMemoryWatermark(plan.advance.conversationId, markOf(plan.advance));
  return counts;
}

/** Plan and apply in one go (tests, scripts); the Inngest function runs them as two steps. */
export async function extractMemories(input: { conversationId: string; messageId: string }) {
  return applyExtraction(await planExtraction(input));
}
