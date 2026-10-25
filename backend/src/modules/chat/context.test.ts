import { describe, expect, it } from 'vitest';
import { agentSystemPrompts } from '../../llm/prompts/agentSystem.js';
import { fitToolGuide } from './context.js';
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
