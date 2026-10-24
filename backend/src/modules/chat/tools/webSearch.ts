import { z } from 'zod';
import { appConfig } from '../../../config/app.config.js';
import { serverConfig } from '../../../config/index.js';
import logger from '../../../config/logger.config.js';
import { consume } from '../../../utils/rateLimit.js';
import type { AgentTool } from './tool.types.js';
import { ToolText } from './toolText.js';

const { apiUrl, maxResults, timeoutMs, resultChars } = appConfig.tools.web;

const input = z.object({
  query: z.string().min(1).max(400).describe('A web search query'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(maxResults)
    .optional()
    .describe(`How many results, at most ${maxResults}`),
});

type TavilyResult = { title?: string; url?: string; content?: string };

const truncate = (text: string) =>
  text.length > resultChars ? `${text.slice(0, resultChars)}…` : text;

export const webSearch: AgentTool<typeof input> = {
  name: 'web_search',
  description:
    "Search the public web. Only when the workspace sources don't cover the question, or for recent facts. Results are external, not the user's sources: say so when you cite them.",
  input,
  async execute(args, ctx) {
    if (!ctx.isOwner)
      return { text: 'Web search is not available in this workspace.', summary: 'not allowed' };
    // A guest can sign up again to reset the per-user limit, and the monthly one is shared.
    if (ctx.isGuest)
      return { text: 'Web search is not available to guest accounts.', summary: 'not allowed' };
    const apiKey = serverConfig.TAVILY_API_KEY;
    if (!apiKey) return { text: 'Web search is not configured.', summary: 'not configured' };

    // The per-user limit first, so one user's spare searches don't use up the shared month.
    const daily = await consume('webSearch', ctx.userId);
    if (!daily.allowed)
      return {
        text: 'The daily web search limit is used up; answer from the sources.',
        summary: 'rate limited',
      };
    const monthly = await consume('webSearchMonthly', 'global');
    if (!monthly.allowed)
      return {
        text: 'Web search is used up for now; answer from the sources.',
        summary: 'rate limited',
      };

    const timeout = AbortSignal.timeout(timeoutMs);
    let results: TavilyResult[];
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: args.query,
          max_results: args.maxResults ?? maxResults,
        }),
        signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error(`Tavily answered ${response.status}`);
      results = ((await response.json()) as { results?: TavilyResult[] }).results ?? [];
    } catch (error) {
      ctx.signal?.throwIfAborted();
      logger.warn('web_search failed', { error: error instanceof Error ? error.message : error });
      return {
        text: 'Web search failed; answer from the sources, or try once more later.',
        summary: 'search failed',
      };
    }

    const usable = results.filter((r): r is Required<TavilyResult> => Boolean(r.url && r.content));
    if (usable.length === 0)
      return { text: `The web search found nothing for "${args.query}".`, summary: 'no results' };

    const out = new ToolText();
    let shown = 0;
    for (const result of usable) {
      const n = out.addSource(ctx.registry, {
        kind: 'WEB',
        sourceTitle: result.title || result.url,
        url: result.url,
        text: truncate(result.content),
      });
      if (n !== null) shown += 1;
    }
    return { text: out.join(), summary: `${shown} web result${shown === 1 ? '' : 's'}` };
  },
};
