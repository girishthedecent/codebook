import { describe, expect, it } from 'vitest';
import { agentSystemPrompts } from '../../llm/prompts/agentSystem.js';
import type { Message } from '../../generated/prisma/client.js';
import { fitToolGuide, toChatMessages } from './context.js';
import { agentTools } from './tools/index.js';

const render = (id: keyof typeof agentSystemPrompts) =>
  agentSystemPrompts[id].render({
    workspaceHint: '',
    sources: '- id=s1 type=WEBSITE title="How web_search and trace_flow work"',
    memory: '(nothing yet)',
    summary: '(none)',
  });

describe('fitToolGuide', () => {
  it('changes nothing when the turn has every tool', () => {
    const system = render('agent-system@v2');
    expect(fitToolGuide(system, new Set(agentTools.map((tool) => tool.name)))).toBe(system);
  });

  it('drops guide lines about missing tools and nothing outside the guide', () => {
    const system = render('agent-system@v3');
    const fitted = fitToolGuide(system, new Set(['search_code', 'list_files', 'read_source']));

    expect(fitted).toContain('- search_code for exact identifiers');
    expect(fitted).toContain('- list_files and read_source to read a file');
    expect(fitted).toContain('- Before the first call, decide which tool fits');
    expect(fitted).not.toContain('- search_sources for concepts');
    expect(fitted).not.toContain('- find_callers, find_dependencies and trace_flow');
    expect(fitted).not.toContain('- web_search only when');
    // The sources list mentions tool names too; it isn't part of the guide.
    expect(fitted).toContain('title="How web_search and trace_flow work"');
  });
});

describe('toChatMessages', () => {
  const message = (role: 'USER' | 'ASSISTANT', content: string) => ({ role, content }) as Message;

  it('keeps one copy of a question that was asked again after a failed answer', () => {
    const history = toChatMessages([
      message('USER', 'hello'),
      message('ASSISTANT', 'hi'),
      message('USER', 'what is a quorum?'),
      message('USER', 'what is a quorum?'),
    ]);

    expect(history.map((m) => m.content)).toEqual(['hello', 'hi', 'what is a quorum?']);
  });

  it('drops a trailing copy of the question being asked now', () => {
    const history = toChatMessages(
      [message('USER', 'hello'), message('ASSISTANT', 'hi'), message('USER', 'what is a quorum?')],
      'what is a quorum? ',
    );

    expect(history.map((m) => m.content)).toEqual(['hello', 'hi']);
  });

  it('keeps different consecutive questions and still starts with a question', () => {
    const history = toChatMessages([
      message('ASSISTANT', 'older answer'),
      message('USER', 'first'),
      message('USER', 'second'),
    ]);

    expect(history.map((m) => m.content)).toEqual(['first', 'second']);
  });
});
