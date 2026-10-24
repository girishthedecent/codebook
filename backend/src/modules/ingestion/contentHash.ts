import { appConfig } from '../../config/app.config.js';
import { embeddingRoute, textRoutes } from '../../llm/models.js';
import { contextualizePrompt } from '../../llm/prompts/contextualize.js';
import { contextualizeCodePrompt } from '../../llm/prompts/contextualizeCode.js';
import { sha256 } from '../../utils/hash.js';

// Everything that changes what the index would contain, so a resync with nothing new can
// skip the work. Bump `ingestion.version` for changes in code that these don't capture.
function sharedSettings() {
  return {
    version: appConfig.ingestion.version,
    chunking: appConfig.ingestion.chunking,
    contextualRetrieval: appConfig.ingestion.contextualRetrieval,
    contextModel: textRoutes.contextualize.primary.model,
    contextPrompt: contextualizePrompt.id,
    embeddingModel: embeddingRoute.model.model,
    dimensions: embeddingRoute.dimensions,
  };
}

/** A PDF's content hash, from its title and text. */
export function ingestHash(title: string, contents: string[]) {
  return sha256(JSON.stringify(sharedSettings()), title, ...contents);
}

/**
 * A repository's content hash, known before downloading anything: a commit's files never
 * change, so the commit and the settings that decide what is kept and how stand for them.
 */
export function repoIngestHash(title: string, commitSha: string) {
  const settings = {
    ...sharedSettings(),
    contextPrompt: contextualizeCodePrompt.id,
    repo: appConfig.ingestion.repo,
  };
  return sha256(JSON.stringify(settings), title, commitSha);
}
