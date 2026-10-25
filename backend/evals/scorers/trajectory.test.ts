import { describe, expect, it } from 'vitest';
import type { SavedToolCall } from '../../src/modules/chat/agent.js';
import type { StoredTrajectory } from '../answer.types.js';
import { expectedToolsOf, scoreTrajectory } from './trajectory.js';

const call = (tool: string, args: unknown, ok = true, step = 1): SavedToolCall => ({
  step,
  tool,
  args,
  ok,
  summary: ok ? '3 passages' : 'The tool failed',
  ms: 10,
  resultTokens: 100,
});

const trajectory = (calls: SavedToolCall[], extra: Partial<StoredTrajectory> = {}) => ({
  calls,
  steps: 3,
  forcedFinal: false,
  staticRag: false,
  model: 'google/gemini-3.6-flash',
  fallbackUsed: false,
  promptId: 'agent-system@v1',
  status: 'COMPLETE' as const,
  ...extra,
});

describe('scoreTrajectory', () => {
  it('reads expected tools from tool: tags only', () => {
    expect(expectedToolsOf(['flow', 'tool:trace_flow', 'gate', 'tool:find_callers'])).toEqual([
      'trace_flow',
      'find_callers',
    ]);
  });

  it('counts any expected tool as used, and redundant calls whatever the key order', () => {
    const scores = scoreTrajectory(
      ['tool:trace_flow', 'tool:find_callers'],
      trajectory([
        call('search_sources', { query: 'res.json', types: ['GITHUB_REPO'] }),
        call('search_sources', { types: ['GITHUB_REPO'], query: 'res.json' }, true, 2),
        call('find_callers', { symbol: 'send' }, false, 2),
        call('search_sources', { query: 'res.send' }, true, 3),
      ]),
    );
    expect(scores).toEqual({
      expectedTools: ['trace_flow', 'find_callers'],
      expectedToolUsed: true,
      steps: 3,
      toolCalls: 4,
      redundantCalls: 1,
      toolErrors: 1,
      hitMaxSteps: false,
    });
  });

  it('has no expected-tool verdict for a case without tool tags', () => {
    const scores = scoreTrajectory(['storage'], trajectory([call('browse_toc', {})]));
    expect(scores.expectedToolUsed).toBeNull();
    expect(scores.expectedTools).toEqual([]);
  });

  it('misses the expected tool when the agent never calls it', () => {
    const scores = scoreTrajectory(
      ['tool:trace_flow'],
      trajectory([call('search_sources', { query: 'x' })]),
    );
    expect(scores.expectedToolUsed).toBe(false);
  });

  it('counts running out of steps, but not static RAG answering in its final step', () => {
    expect(scoreTrajectory([], trajectory([], { forcedFinal: true })).hitMaxSteps).toBe(true);
    expect(
      scoreTrajectory([], trajectory([], { forcedFinal: true, staticRag: true })).hitMaxSteps,
    ).toBe(false);
  });
});
