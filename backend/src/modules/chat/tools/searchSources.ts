import { z } from 'zod';
import { appConfig } from '../../../config/app.config.js';
import { SourceType } from '../../../generated/prisma/enums.js';
import { excerptOf } from '../../demo/excerpt.js';
import { search } from '../../retrieval/retrieval.service.js';
import { QUERY_MODES, type RetrievedChunk } from '../../retrieval/retrieval.types.js';
import type { AgentTool } from './tool.types.js';
import { ToolText } from './toolText.js';
import { toolSources } from './toolSources.js';

const WEAK_HINT =
  'These results look weak. Try rephrasing (queryMode "rewrite"), browse_toc for a book, search_code for an exact name, or web_search if the sources may not cover it.';

const KEYWORD_ONLY_NOTE =
  'Search by meaning is unavailable right now, so these are keyword matches only and may miss passages that use other words.';

const input = z.object({
  query: z
    .string()
    .min(1)
    .max(appConfig.retrieval.maxQueryChars)
    .describe('What to look for, as a question or keywords'),
  sourceIds: z
    .array(z.string())
    .max(appConfig.retrieval.maxSourceIds)
    .optional()
    .describe('Only search these sources'),
  types: z.array(z.enum(SourceType)).optional().describe('Only search these kinds of source'),
  queryMode: z
    .enum(QUERY_MODES)
    .optional()
    .describe('"rewrite" a vague question, "decompose" one with several parts; default none'),
});

/** Where a block's passages are: the page or line range its found children cover. */
function range(children: RetrievedChunk[]) {
  const span = (start: (number | null)[], end: (number | null)[]) => {
    const starts = start.filter((n): n is number => n !== null);
    const ends = end.filter((n): n is number => n !== null);
    return starts.length > 0
      ? { from: Math.min(...starts), to: Math.max(...ends, ...starts) }
      : null;
  };
  const pages = span(
    children.map((c) => c.pageStart),
    children.map((c) => c.pageEnd),
  );
  const lines = span(
    children.map((c) => c.lineStart),
    children.map((c) => c.lineEnd),
  );
  return { pages, lines };
}

export const searchSources: AgentTool<typeof input> = {
  name: 'search_sources',
  description:
    'Search the workspace sources (books, documents, repositories, web pages) by meaning and keywords. Best for concepts and explanations. Returns numbered passages to cite as [n].',
  input,
  async execute(args, ctx) {
    let sourceIds = args.sourceIds;
    if (sourceIds) {
      sourceIds = (await toolSources(ctx, sourceIds)).map((source) => source.id);
      if (sourceIds.length === 0)
        return { text: 'None of those sources are in this workspace.', summary: 'no such sources' };
    }

    const { results, parents, debug } = await search({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      query: args.query,
      sourceIds,
      sourceTypes: args.types,
      // Model calls and reranking cost the owner's quota; a demo visitor gets plain search.
      queryMode: ctx.isOwner ? args.queryMode : 'none',
      rerank: false,
      expandParents: true,
      messageId: ctx.messageId,
      signal: ctx.signal,
    });

    if (parents.length === 0) {
      return {
        text: `Nothing found for "${args.query}". ${WEAK_HINT}`,
        summary: 'no results',
        weak: true,
      };
    }

    // One citation per block the model reads, located by the children that matched in it.
    const byId = new Map(results.map((chunk) => [chunk.chunkId, chunk]));
    const out = new ToolText();
    // First, so they survive a full budget.
    if (debug.keywordOnly) out.add(KEYWORD_ONLY_NOTE);
    if (debug.weak) out.add(WEAK_HINT);
    const sources = new Set<string>();
    let shown = 0;
    for (const block of parents) {
      const children = block.childIds.flatMap((id) => byId.get(id) ?? []);
      const best = children[0];
      if (!best) continue;
      const { pages, lines } = range(children);
      const n = out.addSource(ctx.registry, {
        kind: 'CHUNK',
        chunkId: best.chunkId,
        sourceId: block.sourceId,
        sourceTitle: block.sourceTitle,
        sourceType: best.sourceType,
        path: block.documentPath,
        heading: block.headingPath.join(' > ') || undefined,
        pageStart: pages?.from,
        pageEnd: pages?.to,
        lineStart: lines?.from,
        lineEnd: lines?.to,
        // A demo visitor's agent gets an excerpt of the matched text, not the whole section
        // of a book.
        text:
          !ctx.isOwner && best.sourceType === 'PDF'
            ? excerptOf(children.map((chunk) => chunk.content).join('\n\n')).text
            : block.content,
      });
      if (n === null) continue;
      shown += 1;
      sources.add(block.sourceId);
    }

    return {
      text: out.join(),
      summary: `${shown} passage${shown === 1 ? '' : 's'} from ${sources.size} source${sources.size === 1 ? '' : 's'}${debug.weak ? ', weak' : ''}`,
      weak: debug.weak,
    };
  },
};
