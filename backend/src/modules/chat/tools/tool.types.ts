import type { z } from 'zod';
import type { CitationRegistry } from '../../citations/citationRegistry.js';

export type ToolContext = {
  userId: string;
  workspaceId: string;
  // False on someone else's demo workspace: no query modes, reranking or web search there.
  isOwner: boolean;
  // Guest accounts are free to re-create, so a per-user limit can't hold them: no web search.
  isGuest: boolean;
  // The assistant message being answered, so model calls a tool makes count toward its cost.
  messageId?: string;
  // Every passage a tool shows the model is numbered here.
  registry: CitationRegistry;
  signal?: AbortSignal;
};

export type ToolResult = {
  // What the model reads: rendered <source> blocks or plain text, already size-capped.
  text: string;
  // One line for the `step` event and the saved tool call, e.g. "5 passages from 2 sources".
  summary: string;
  // search_sources only: the search found nothing good, so the agent should try another way.
  weak?: boolean;
};

export type AgentTool<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: Schema;
  execute(args: z.infer<Schema>, ctx: ToolContext): Promise<ToolResult>;
};
