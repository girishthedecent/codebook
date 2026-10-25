import { appConfig } from '../../config/app.config.js';
import type { Memory, MemoryKind } from '../../generated/prisma/client.js';
import { embedTexts } from '../../llm/embeddings.js';
import { ConflictError, NotFoundError } from '../../utils/errors/app.error.js';
import type { ListMemoriesQuery, UpdateMemoryInput } from './memory.dto.js';
import {
  countLive,
  createMemory,
  findMemory,
  leastImportantProfile,
  listMemories,
  purgeAll,
  restoreMemory,
  softDeleteAll,
  softDeleteMemory,
  updateMemory,
} from './memory.repository.js';

export type NewMemory = { kind: MemoryKind; content: string; importance?: number };

const DEFAULT_IMPORTANCE = 3;

/** One line, as it is stored and shown to the agent. */
export function cleanContent(content: string) {
  return content.replace(/\s+/g, ' ').trim().slice(0, appConfig.memory.maxContentChars);
}

/** Memories are embedded as documents, so a question (a query) lands near the ones it needs. */
export async function embedMemory(userId: string, content: string) {
  const [vector] = await embedTexts([content], {
    kind: 'document',
    title: 'About the user',
    ctx: { userId },
    // Someone is waiting on the API, and extraction writes a handful at most.
    waitForQuota: false,
  });
  return vector!;
}

async function memoryFor(userId: string, id: string) {
  const memory = await findMemory(userId, id);
  if (!memory) throw new NotFoundError('Memory not found');
  return memory;
}

/** Thrown when a full profile has no line less important than the new one. */
export class ProfileFullError extends ConflictError {
  constructor() {
    super(
      `Your profile already has ${appConfig.memory.profileCap} lines that matter at least as ` +
        'much. Delete one, or add this one with a higher importance.',
    );
  }
}

/**
 * Adds one memory for the user (embedded), as the API and the extractor do. Profile lines
 * are capped: past the cap, the new line replaces the least important one, if it matters at
 * least as much (the replaced one can be restored once there is room again).
 */
export async function addMemory(
  userId: string,
  input: NewMemory,
  sourceMessageId?: string,
): Promise<Memory> {
  const content = cleanContent(input.content);
  const importance = input.importance ?? DEFAULT_IMPORTANCE;
  let evictId: string | undefined;
  // Not locked: two adds at once can leave one line over the cap until the next add.
  if (
    input.kind === 'PROFILE' &&
    (await countLive(userId, 'PROFILE')) >= appConfig.memory.profileCap
  ) {
    const weakest = await leastImportantProfile(userId);
    if (weakest && weakest.importance > importance) throw new ProfileFullError();
    evictId = weakest?.id;
  }
  const embedding = await embedMemory(userId, content);
  return createMemory(
    userId,
    { kind: input.kind, content, importance, sourceMessageId },
    embedding,
    evictId,
  );
}

export function listMemoriesService(userId: string, query: ListMemoriesQuery) {
  return listMemories(userId, { kind: query.kind, includeDeleted: query.includeDeleted });
}

export async function createMemoryService(userId: string, input: NewMemory) {
  return addMemory(userId, input);
}

export async function updateMemoryService(userId: string, id: string, input: UpdateMemoryInput) {
  const memory = await memoryFor(userId, id);
  if (memory.deletedAt) throw new ConflictError('Restore this memory before editing it');
  const content = input.content === undefined ? undefined : cleanContent(input.content);
  const changed = content !== undefined && content !== memory.content;
  const embedding = changed ? await embedMemory(userId, content) : undefined;
  const updated = await updateMemory(
    userId,
    id,
    { content: changed ? content : undefined, importance: input.importance },
    embedding,
  );
  if (!updated) throw new NotFoundError('Memory not found');
  return updated;
}

export async function deleteMemoryService(userId: string, id: string) {
  const memory = await memoryFor(userId, id);
  if (!memory.deletedAt) await softDeleteMemory(userId, id);
}

export async function restoreMemoryService(userId: string, id: string) {
  const memory = await memoryFor(userId, id);
  if (!memory.deletedAt) return memory;
  if (
    memory.kind === 'PROFILE' &&
    (await countLive(userId, 'PROFILE')) >= appConfig.memory.profileCap
  ) {
    throw new ConflictError(
      `You already have ${appConfig.memory.profileCap} profile memories. Delete one first.`,
    );
  }
  await restoreMemory(userId, id);
  return memoryFor(userId, id);
}

/** Deletes every memory (they can still be restored one by one). */
export function clearMemoriesService(userId: string) {
  return softDeleteAll(userId);
}

/** Deletes every memory of the user for good (the eval user between cases). */
export async function purgeMemories(userId: string): Promise<number> {
  return purgeAll(userId);
}
