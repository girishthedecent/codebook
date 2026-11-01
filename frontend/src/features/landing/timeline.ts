import type { TurnFixture, TurnStep } from './fixtureTypes';

// Turns a recorded turn into a schedule for the replay. The real times stay on the page (a
// step shows how long it really took); the schedule only squeezes the waits so a viewer isn't
// kept watching a model think.

export type ScheduledStep = { step: TurnStep; start: number; end: number };
export type Schedule = {
  steps: ScheduledStep[];
  chunks: Array<{ at: number; text: string }>;
  total: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function schedule(turn: TurnFixture): Schedule {
  const steps: ScheduledStep[] = [];
  let cursor = 400;
  let groupStart = -1;
  let groupRealStart = -1;
  let groupEnd = cursor;
  let realEnd = 0;
  for (const step of [...turn.steps].sort((a, b) => a.startAt - b.startAt)) {
    const parallel = groupStart >= 0 && step.startAt - groupRealStart < 60;
    if (!parallel) {
      cursor = groupEnd + (groupStart < 0 ? 0 : clamp(step.startAt - realEnd, 200, 700));
      groupStart = cursor;
      groupRealStart = step.startAt;
      groupEnd = cursor;
    }
    const end = groupStart + clamp(step.ms ?? 300, 350, 900);
    steps.push({ step, start: groupStart, end });
    groupEnd = Math.max(groupEnd, end);
    realEnd = Math.max(realEnd, step.startAt + (step.ms ?? 0));
  }

  const first = turn.chunks[0]?.at ?? 0;
  const last = turn.chunks[turn.chunks.length - 1]?.at ?? first;
  const answerStart = groupEnd + clamp(first - realEnd, 300, 900);
  const scale = Math.min(1, 6500 / Math.max(last - first, 1));
  const chunks = turn.chunks.map((c) => ({
    at: answerStart + (c.at - first) * scale,
    text: c.text,
  }));
  const total = (chunks[chunks.length - 1]?.at ?? answerStart) + 500;
  return { steps, chunks, total };
}

/** The answer as written at `time`, without a marker that is still half typed. */
export function answerAt(plan: Schedule, time: number): string {
  let text = '';
  for (const chunk of plan.chunks) {
    if (chunk.at > time) break;
    text += chunk.text;
  }
  return text.replace(/\[[\d, ]*$/, '');
}

type Args = Record<string, unknown>;

const verbs: Record<string, string> = {
  search_sources: 'searched sources',
  read_source: 'read',
  browse_toc: 'looked at the contents',
  list_files: 'listed files',
  search_code: 'searched code',
  find_callers: 'found callers',
  find_dependencies: 'found dependencies',
  trace_flow: 'traced',
  web_search: 'searched the web',
};

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** What a step did and to what, e.g. `searched sources` and `"causal self-attention"`. */
export function describeStep(step: TurnStep): { verb: string; detail: string } {
  const verb = verbs[step.tool] ?? step.tool.replaceAll('_', ' ');
  const args = (step.args && typeof step.args === 'object' ? step.args : {}) as Args;
  const query = text(args.query) ?? text(args.pattern);
  if (query) return { verb, detail: `“${query}”` };
  const path = text(args.path);
  if (path) {
    const a = args.lineStart;
    const b = args.lineEnd;
    return {
      verb,
      detail: typeof a === 'number' ? `${path}:${a}${typeof b === 'number' ? `–${b}` : ''}` : path,
    };
  }
  if (typeof args.page === 'number') {
    return {
      verb,
      detail:
        typeof args.pageEnd === 'number' ? `pp. ${args.page}–${args.pageEnd}` : `p. ${args.page}`,
    };
  }
  const symbol = text(args.symbol) ?? text(args.from);
  if (symbol) return { verb, detail: symbol };
  return { verb, detail: step.summary ?? '' };
}

export function formatMs(ms: number | undefined) {
  if (ms === undefined) return '';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
