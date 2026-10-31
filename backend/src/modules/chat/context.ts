import prismaClient from '../../config/db.config.js';
import type { Message, Workspace } from '../../generated/prisma/client.js';
import type { ChatMessage } from '../../llm/client.js';
import { DEFAULT_AGENT_PROMPT, agentSystemPrompts } from '../../llm/prompts/agentSystem.js';
import { demoBooksInFull } from '../demo/excerpt.js';
import { memoryBlock } from '../memory/memory.recall.js';
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

// Visitors of the demo (everyone but its owner), unless it shows its books in full: its book
// is copyrighted.
const DEMO_HINT =
  '- This is the public demo workspace: quote at most two short lines from a source, and summarize instead of copying longer passages.';

/** The template's preferred tools, and on the demo how much to quote, as tool guide lines. */
function workspaceHint(workspace: Workspace, userId: string, available: ReadonlySet<string>) {
  const settings = workspace.settings as { preferredTools?: unknown } | null;
  const preferred = Array.isArray(settings?.preferredTools)
    ? settings.preferredTools.filter((name): name is string => typeof name === 'string')
    : [];
  const known = preferred.filter((name) => available.has(name));
  const lines = [
    known.length > 0 ? `- In this workspace, start with ${known.join(' or ')}.` : '',
    workspace.isDemo && workspace.userId !== userId && !demoBooksInFull() ? DEMO_HINT : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Drops the tool guide's lines about tools this turn doesn't have (eval ablations), so the
 * model isn't told to call something that isn't there. With every tool, nothing changes.
 */
export function fitToolGuide(system: string, available: ReadonlySet<string>) {
  const start = system.indexOf('\nChoosing tools:\n');
  if (start === -1) return system;
  const end = system.indexOf('\n\n', start + 1);
  const section = system.slice(start, end === -1 ? undefined : end);
  const kept = section
    .split('\n')
    .filter((line) => [...toolNames].every((name) => available.has(name) || !line.includes(name)))
    .join('\n');
  return system.slice(0, start) + kept + (end === -1 ? '' : system.slice(end));
}

/**
 * The saved messages as chat messages. A question whose answer failed stays in the transcript,
 * and asking it again saves it a second time; the model should see it once, so a question
 * followed by the same question is dropped, and so is a trailing copy of the one being asked.
 */
export function toChatMessages(messages: Message[], asking?: string): ChatMessage[] {
  const same = (a: string, b: string) => a.trim() === b.trim();
  const history = messages
    .filter((message, i) => {
      if (message.role !== 'USER') return true;
      const next = messages[i + 1];
      if (next?.role === 'USER' && same(next.content, message.content)) return false;
      return !(i === messages.length - 1 && asking !== undefined && same(asking, message.content));
    })
    .map((message): ChatMessage =>
      message.role === 'USER'
        ? { role: 'user', content: message.content }
        : // Citation numbers belong to the turn that made them; this turn numbers anew.
          { role: 'assistant', content: message.content.replace(CITATION_MARKER, '') },
    );
  // History trimmed from the front may start with an answer; models expect a question first.
  while (history[0]?.role === 'assistant') history.shift();
  return history;
}

export type AgentPromptId = keyof typeof agentSystemPrompts;

export type ContextInput = {
  workspace: Workspace;
  conversationId: string;
  questionId: string;
  question: string;
  userId: string;
  isGuest: boolean;
  useMemory: boolean;
  promptId?: AgentPromptId;
  // The tools this turn gets; every tool when left out.
  toolNames?: string[];
};

/**
 * The agent's system prompt and the conversation before this question. The question is
 * saved before this runs, so it is left out of the history here and sent on its own.
 */
export async function buildAgentContext(input: ContextInput) {
  const prompt = agentSystemPrompts[input.promptId ?? DEFAULT_AGENT_PROMPT];
  const [sources, { summary, recent }, memory] = await Promise.all([
    sourcesList(input.workspace.id),
    conversationHistory(input.conversationId),
    memoryBlock({
      userId: input.userId,
      isGuest: input.isGuest,
      question: input.question,
      enabled: input.useMemory,
    }),
  ]);
  const available = new Set(input.toolNames ?? toolNames);
  const system = fitToolGuide(
    prompt.render({
      workspaceHint: workspaceHint(input.workspace, input.userId, available),
      sources,
      memory,
      summary: summary?.trim() || '(none)',
    }),
    available,
  );
  return {
    system,
    promptId: prompt.id,
    history: toChatMessages(
      recent.filter((message) => message.id !== input.questionId),
      input.question,
    ),
  };
}
