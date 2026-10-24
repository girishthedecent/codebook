import prismaClient from '../../config/db.config.js';
import type { Message, Workspace } from '../../generated/prisma/client.js';
import type { ChatMessage } from '../../llm/client.js';
import { agentSystemPrompt } from '../../llm/prompts/agentSystem.js';
import { conversationHistory } from './conversation.service.js';
import { agentTools } from './tools/index.js';

const TITLE_CHARS = 120;
const CITATION_MARKER = / ?\[\d+(?:\s*,\s*\d+)*\]/g;

const toolNames = new Set(agentTools.map((tool) => tool.name));

// Titles come from PDFs, repositories and web pages: one line each, and short.
const oneLine = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS)}…` : line;
};

/**
 * The sources the agent can use. A source with an index serves it even while a resync runs
 * or after one failed, so "usable" means indexed at least once, not READY.
 */
async function sourcesList(workspaceId: string) {
  const sources = await prismaClient.source.findMany({
    where: { workspaceId, lastIngestedAt: { not: null } },
    select: { id: true, title: true, type: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  if (sources.length === 0) {
    return '(none yet: tell the user to add a book, repository or web page first)';
  }
  return sources
    .map((source) => {
      const note = source.status === 'READY' ? '' : ' (being re-indexed; the last index is used)';
      return `- id=${source.id} type=${source.type} title="${oneLine(source.title).replace(/"/g, "'")}"${note}`;
    })
    .join('\n');
}

/** The template's preferred tools, as one line of the tool guide. */
function workspaceHint(workspace: Workspace) {
  const settings = workspace.settings as { preferredTools?: unknown } | null;
  const preferred = Array.isArray(settings?.preferredTools)
    ? settings.preferredTools.filter((name): name is string => typeof name === 'string')
    : [];
  const known = preferred.filter((name) => toolNames.has(name));
  return known.length > 0 ? `- In this workspace, start with ${known.join(' or ')}.` : '';
}

function toChatMessages(messages: Message[]): ChatMessage[] {
  const history = messages.map((message): ChatMessage =>
    message.role === 'USER'
      ? { role: 'user', content: message.content }
      : // Citation numbers belong to the turn that made them; this turn numbers anew.
        { role: 'assistant', content: message.content.replace(CITATION_MARKER, '') },
  );
  // History trimmed from the front may start with an answer; models expect a question first.
  while (history[0]?.role === 'assistant') history.shift();
  return history;
}

/**
 * The agent's system prompt and the conversation before this question. The question is
 * saved before this runs, so it is left out of the history here and sent on its own.
 */
export async function buildAgentContext(
  workspace: Workspace,
  conversationId: string,
  questionId: string,
) {
  const [sources, { summary, recent }] = await Promise.all([
    sourcesList(workspace.id),
    conversationHistory(conversationId),
  ]);
  const system = agentSystemPrompt.render({
    workspaceHint: workspaceHint(workspace),
    sources,
    // Phase 12 (memory) fills this.
    memory: '(nothing yet)',
    summary: summary?.trim() || '(none)',
  });
  return {
    system,
    history: toChatMessages(recent.filter((message) => message.id !== questionId)),
  };
}
