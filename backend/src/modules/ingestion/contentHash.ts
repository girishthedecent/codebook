import { appConfig } from '../../config/app.config.js';
import { embeddingRoute, textRoutes } from '../../llm/models.js';
import { contextualizePrompt } from '../../llm/prompts/contextualize.js';
import { contextualizeCodePrompt } from '../../llm/prompts/contextualizeCode.js';
import { sha256 } from '../../utils/hash.js';

// Everything that changes what the index would contain, so a resync with nothing new can
// skip the work. Bump `ingestion.version` for changes in code that these don't capture.
// `contextual` is the source's workspace setting (contextualRetrievalFor), so turning
// contextual retrieval off for a workspace re-indexes its sources.
function sharedSettings(contextual: boolean) {
  return {
    version: appConfig.ingestion.version,
    chunking: appConfig.ingestion.chunking,
    contextualRetrieval: contextual,
    contextModel: textRoutes.contextualize.primary.model,
    contextPrompt: contextualizePrompt.id,
    embeddingModel: embeddingRoute.model.model,
    dimensions: embeddingRoute.dimensions,
  };
}

/** A PDF's content hash, from its title and text. */
export function ingestHash(
  title: string,
  contents: string[],
  contextual: boolean = appConfig.ingestion.contextualRetrieval,
) {
  return sha256(JSON.stringify(sharedSettings(contextual)), title, ...contents);
}

/**
 * A repository's content hash, known before downloading anything: a commit's files never
 * change, so the commit and the settings that decide what is kept and how stand for them.
 */
export function repoIngestHash(
  title: string,
  commitSha: string,
  contextual: boolean = appConfig.ingestion.contextualRetrieval,
) {
  const settings = {
    ...sharedSettings(contextual),
    contextPrompt: contextualizeCodePrompt.id,
    repo: appConfig.ingestion.repo,
    graph: appConfig.ingestion.graph,
  };
  return sha256(JSON.stringify(settings), title, commitSha);
}

/**
 * A website's content hash, from its extracted pages (url and text hash, in url order) and
 * the crawl limits that chose them.
 */
export function websiteIngestHash(
  title: string,
  limits: { maxDepth: number; maxPages: number },
  pages: { url: string; hash: string }[],
  contextual: boolean = appConfig.ingestion.contextualRetrieval,
) {
  const settings = { ...sharedSettings(contextual), website: appConfig.ingestion.website, limits };
  const sorted = [...pages].sort((a, b) => (a.url < b.url ? -1 : 1));
  return sha256(
    JSON.stringify(settings),
    title,
    ...sorted.map((page) => `${page.url} ${page.hash}`),
  );
}
