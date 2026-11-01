// How an agent step reads in the transcript. A step in progress is named in the present
// ("Searching the sources"), a finished one in the past ("Searched the sources"), followed by
// a short detail taken from the tool's arguments.

const names: Record<string, { running: string; past: string }> = {
  search_sources: { running: 'Searching the sources', past: 'Searched the sources' },
  read_source: { running: 'Reading', past: 'Read' },
  browse_toc: { running: 'Looking at the contents', past: 'Looked at the contents' },
  list_files: { running: 'Listing files', past: 'Listed files' },
  search_code: { running: 'Searching the code', past: 'Searched the code' },
  find_callers: { running: 'Finding callers', past: 'Found callers' },
  find_dependencies: { running: 'Finding dependencies', past: 'Found dependencies' },
  trace_flow: { running: 'Tracing the call flow', past: 'Traced the call flow' },
  web_search: { running: 'Searching the web', past: 'Searched the web' },
  recall_memory: { running: 'Checking memory', past: 'Checked memory' },
};

function plain(tool: string) {
  const words = tool.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function stepPast(tool: string) {
  return names[tool]?.past ?? plain(tool);
}

export function stepRunning(tool: string) {
  return names[tool]?.running ?? plain(tool);
}

type Args = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const quote = (s: string) => `“${clip(s, 60)}”`;

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
        return end && end !== page ? `pages ${page}–${end}` : `page ${page}`;
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

/** What a tool reported, without the trailing `[n]` that numbers the passage it read. */
export function stepSummary(summary: string | undefined) {
  return summary?.replace(/\s*\[\d+\]$/, '').trim() ?? '';
}

export function formatMs(ms: number | undefined) {
  if (ms === undefined) return '';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
