import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import logger from '../../config/logger.config.js';
import { generateObject, type CallContext } from '../../llm/client.js';
import { textRoutes } from '../../llm/models.js';
import { contextualizePrompt } from '../../llm/prompts/contextualize.js';
import { UpstreamError } from '../../utils/errors/app.error.js';
import { sha256 } from '../../utils/hash.js';
import { createPacer } from '../../utils/pacer.js';
import { findContexts, saveContexts } from './ingestion.repository.js';

export type ParentToContextualize = {
  title: string;
  headingPath: string[];
  text: string;
  children: { hash: string; text: string }[];
};

const contextSchema = z.object({
  contexts: z.array(z.object({ chunk: z.int().min(1), context: z.string() })),
});

// Shared by every ingest in this process, so two books at once still stay under the
// free-tier rate.
const pace = createPacer(appConfig.ingestion.contextualize.minIntervalMs);

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
 * Writes the missing contexts of one parent's children into the cache with one model call.
 * False when the call failed; children it didn't return a context for stay without one.
 */
export async function contextualizeParent(parent: ParentToContextualize, ctx: CallContext) {
  const keys = contextKeys(parent);
  const cached = await findContexts(keys);
  if (keys.every((key) => cached.has(key))) return true;

  const chunks = parent.children
    .map((child, i) => `<chunk n="${i + 1}">\n${child.text}\n</chunk>`)
    .join('\n\n');
  await pace();
  let contexts: z.infer<typeof contextSchema>['contexts'];
  try {
    const { object } = await generateObject({
      task: 'contextualize',
      schema: contextSchema,
      prompt: contextualizePrompt.render({
        title: parent.title,
        headingPath: parent.headingPath.join(' > ') || '(none)',
        section: parent.text,
        chunks,
      }),
      ctx,
    });
    contexts = object.contexts;
  } catch (error) {
    // The client has logged the provider's error and recorded the failed call.
    if (!(error instanceof UpstreamError)) throw error;
    logger.warn('Contextualizing a section failed', { headingPath: parent.headingPath });
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
