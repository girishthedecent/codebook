// How an agent step reads in the transcript: a past-tense verb and a short detail taken from
// the tool's arguments, e.g. `searched sources  "leader failure"`.

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
  recall_memory: 'checked memory',
};

// While a step runs the status line names it in the present.
const running: Record<string, string> = {
  search_sources: 'Searching sources',
  read_source: 'Reading',
  browse_toc: 'Looking at the contents',
  list_files: 'Listing files',
  search_code: 'Searching code',
  find_callers: 'Finding callers',
  find_dependencies: 'Finding dependencies',
  trace_flow: 'Tracing the flow',
  web_search: 'Searching the web',
  recall_memory: 'Checking memory',
};

export function stepVerb(tool: string) {
  return verbs[tool] ?? tool.replaceAll('_', ' ');
}

export function stepRunning(tool: string) {
  return running[tool] ?? stepVerb(tool);
}

type Args = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const quote = (s: string) => `"${clip(s, 60)}"`;

function clip(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function symbol(v: unknown) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Args;
    return str(o.name) ?? str(o.qualifiedName) ?? str(o.symbol);
  }
  return undefined;
}

/** The one-line detail for a step, or '' when the arguments say nothing useful. */
export function stepDetail(tool: string, raw: unknown): string {
  const args = (raw && typeof raw === 'object' ? raw : {}) as Args;
  switch (tool) {
    case 'search_sources':
    case 'web_search':
    case 'recall_memory': {
      const q = str(args.query);
      return q ? quote(q) : '';
    }
    case 'search_code': {
      const p = str(args.pattern);
      const under = str(args.pathPrefix);
      return [p && quote(p), under && `in ${under}`].filter(Boolean).join(' ');
    }
    case 'read_source': {
      const path = str(args.path);
      const page = num(args.page);
      if (path) {
        const a = num(args.lineStart);
        const b = num(args.lineEnd);
        return a ? `${clip(path, 60)}:${a}${b && b !== a ? `–${b}` : ''}` : clip(path, 60);
      }
      if (page) {
        const end = num(args.pageEnd);
        return end && end !== page ? `pp. ${page}–${end}` : `p. ${page}`;
      }
      return str(args.tocNodeId) ? 'a section' : '';
    }
    case 'list_files': {
      const prefix = str(args.prefix);
      return prefix ? clip(prefix, 60) : '';
    }
    case 'find_callers':
    case 'find_dependencies': {
      const s = symbol(args.symbol);
      return s ? clip(s, 60) : '';
    }
    case 'trace_flow': {
      const from = symbol(args.from);
      const to = symbol(args.to);
      return from && to ? `${clip(from, 30)} → ${clip(to, 30)}` : '';
    }
    default:
      return '';
  }
}

export function formatMs(ms: number | undefined) {
  if (ms === undefined) return '';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
