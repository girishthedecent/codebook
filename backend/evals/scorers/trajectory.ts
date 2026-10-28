import type { StoredTrajectory, TrajectoryScores } from '../answer.types.js';

// How the agent got to its answer: did it reach for the tool the question
// needs, and how much did it waste on the way.

const TOOL_TAG = 'tool:';

/** The tools a case expects, from its `tool:<name>` tags. Any one of them counts. */
export function expectedToolsOf(tags: string[]) {
  return tags.filter((tag) => tag.startsWith(TOOL_TAG)).map((tag) => tag.slice(TOOL_TAG.length));
}

/** JSON with sorted keys, so {a, b} and {b, a} are the same arguments. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function scoreTrajectory(tags: string[], trajectory: StoredTrajectory): TrajectoryScores {
  const expectedTools = expectedToolsOf(tags);
  const { calls } = trajectory;

  const seen = new Set<string>();
  let redundantCalls = 0;
  for (const call of calls) {
    const key = `${call.tool}\0${stableJson(call.args)}`;
    if (seen.has(key)) redundantCalls += 1;
    seen.add(key);
  }

  return {
    expectedTools,
    expectedToolUsed:
      expectedTools.length === 0 ? null : calls.some((call) => expectedTools.includes(call.tool)),
    steps: trajectory.steps,
    toolCalls: calls.length,
    redundantCalls,
    toolErrors: calls.filter((call) => !call.ok).length,
    // Static RAG always answers in its final step; that isn't running out of steps.
    hitMaxSteps: trajectory.forcedFinal && !trajectory.staticRag,
  };
}
