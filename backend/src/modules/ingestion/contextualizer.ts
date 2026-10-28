import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import logger from '../../config/logger.config.js';
import { generateObject, type CallContext } from '../../llm/client.js';
import { hasBackupKey, textRoutes, type ModelRef } from '../../llm/models.js';
import { contextualizePrompt } from '../../llm/prompts/contextualize.js';
import { contextualizeCodePrompt } from '../../llm/prompts/contextualizeCode.js';
import { UpstreamError } from '../../utils/errors/app.error.js';
import { sha256 } from '../../utils/hash.js';
import { createPacer } from '../../utils/pacer.js';
import { findContexts, saveContexts } from './ingestion.repository.js';

type Chunk = { hash: string; text: string };

export type ParentToContextualize = {
  title: string;
  headingPath: string[];
  text: string;
  children: Chunk[];
};

// A repository file as the code prompt shows it: path and outline, without the full text.
export type FileHeader = { path: string; outline: string };

/** Chunks from a few files of one repository, contextualized in one call. */
export type CodePack = { title: string; items: { file: FileHeader; chunk: Chunk }[] };

const contextSchema = z.object({
  contexts: z.array(z.object({ chunk: z.int().min(1), context: z.string() })),
});

// Shared by every ingest in this process, so two books at once still stay under the
// free-tier rate. Each Gemini key is a project with its own per-minute limit, so with a
// backup key the calls alternate between the two. Each key is paced as it is called, so a
// call that falls over to the other key (or skips a key that ran out) waits its turn there.
const { minIntervalMs } = appConfig.ingestion.contextualize;
const pacers = { primary: createPacer(minIntervalMs), backup: createPacer(minIntervalMs) };
const paceKey = (ref: ModelRef) => (ref.key === 'backup' ? pacers.backup : pacers.primary)();
let calls = 0;

/** How many contextualize calls can usefully run at once: one per Gemini key. */
export const contextualizeLanes = () => (hasBackupKey() ? 2 : 1);

// The prompt's inputs other than the chunk itself, so a cached context is only reused for
// the same section of the same document.
function parentHash(parent: ParentToContextualize) {
  return sha256(parent.title, parent.headingPath.join('\n'), parent.text);
}

/** Cache keys of a parent's children, in order. */
export function contextKeys(parent: ParentToContextualize) {
  const model = textRoutes.contextualize.primary.model;
  const hash = parentHash(parent);
  return parent.children.map((child) => sha256(model, contextualizePrompt.id, hash, child.hash));
}

/**
 * Cache key of a repository chunk's context. It depends on the chunk's own file only, not
 * on the other files sharing its call, so changing how chunks are packed keeps the cache.
 */
export function codeContextKey(title: string, file: FileHeader, chunkHash: string) {
  const fileHash = sha256(title, file.path, file.outline);
  return sha256(
    textRoutes.contextualize.primary.model,
    contextualizeCodePrompt.id,
    fileHash,
    chunkHash,
  );
}

/**
 * Writes the missing contexts of one parent's children into the cache with one model call.
 * False when the call failed; children it didn't return a context for stay without one.
 */
export async function contextualizeParent(parent: ParentToContextualize, ctx: CallContext) {
  const keys = contextKeys(parent);
  const cached = await findContexts(keys);
  if (keys.every((key) => cached.has(key))) return true;

  const chunks = parent.children.map((child, i) => numbered(i, child.text)).join('\n\n');
  const prompt = contextualizePrompt.render({
    title: parent.title,
    headingPath: parent.headingPath.join(' > ') || '(none)',
    section: parent.text,
    chunks,
  });
  const done = await writeContexts(keys, prompt, ctx);
  if (!done) logger.warn('Contextualizing a section failed', { headingPath: parent.headingPath });
  return done;
}

/**
 * Like `contextualizeParent` for a pack of repository chunks: only the chunks without a
 * cached context are sent, numbered 1…k, each under its file's path and outline.
 */
export async function contextualizePack(pack: CodePack, ctx: CallContext) {
  const keyed = pack.items.map((item) => ({
    ...item,
    key: codeContextKey(pack.title, item.file, item.chunk.hash),
  }));
  const cached = await findContexts(keyed.map((item) => item.key));
  const missing = keyed.filter((item) => !cached.has(item.key));
  if (missing.length === 0) return true;

  const files: string[] = [];
  missing.forEach((item, i) => {
    const previous = missing[i - 1];
    if (previous?.file.path !== item.file.path) {
      if (previous) files.push('</file>');
      files.push(
        `<file path="${item.file.path}">\n<outline>\n${item.file.outline || '(none)'}\n</outline>`,
      );
    }
    files.push(numbered(i, item.chunk.text));
  });
  files.push('</file>');

  const prompt = contextualizeCodePrompt.render({ title: pack.title, files: files.join('\n\n') });
  const keys = missing.map((item) => item.key);
  const done = await writeContexts(keys, prompt, ctx);
  if (!done)
    logger.warn('Contextualizing code failed', {
      paths: [...new Set(missing.map((item) => item.file.path))],
    });
  return done;
}

function numbered(index: number, text: string) {
  return `<chunk n="${index + 1}">\n${text}\n</chunk>`;
}

// One model call whose numbered contexts go to `keys` (chunk n → keys[n - 1]). False when
// the call failed.
async function writeContexts(keys: string[], prompt: string, ctx: CallContext) {
  const onBackup = hasBackupKey() && calls++ % 2 === 1;
  let contexts: z.infer<typeof contextSchema>['contexts'];
  try {
    const { object } = await generateObject({
      task: 'contextualize',
      schema: contextSchema,
      prompt,
      ctx,
      startWith: onBackup ? 'backup' : undefined,
      pace: paceKey,
    });
    contexts = object.contexts;
  } catch (error) {
    // The client has logged the provider's error and recorded the failed call.
    if (!(error instanceof UpstreamError)) throw error;
    return false;
  }

  await saveContexts(
    contexts.flatMap(({ chunk, context }) => {
      const key = keys[chunk - 1];
      const text = context.trim();
      return key && text ? [{ key, context: text }] : [];
    }),
  );
  return true;
}
