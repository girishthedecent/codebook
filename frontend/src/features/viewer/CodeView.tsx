import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { sourceContentQueryOptions } from '@/api/queries';
import { Button, ProgressRule } from '@/ui';
import { cn } from '@/lib/cn';
import { languageFor, useHighlight, type Token } from './highlight';
import { ViewError } from './ViewError';
import { s } from './strings';

// The content API returns at most 400 lines per request; windows are aligned to that.
const WINDOW = 400;
// Files up to this size are loaded whole; longer ones grow a window at a time.
const LOAD_WHOLE = 2000;
const VIRTUALIZE_ABOVE = 2000;
const LINE_HEIGHT = 20;

type Props = {
  sourceId: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
};

type Line = { n: number; text: string };

const windowOf = (line: number) => Math.floor((line - 1) / WINDOW);

/** A repository file: line numbers, highlighting, the cited lines marked and in view. */
export function CodeView({ sourceId, path, lineStart, lineEnd }: Props) {
  const first = windowOf(lineStart ?? 1);
  const last = windowOf(lineEnd ?? lineStart ?? 1);
  const [extra, setExtra] = useState<{ key: string; windows: number[] }>();
  const key = `${sourceId}:${path}`;

  // The cited window(s), one more above when the citation sits near a window's top, and
  // whatever the user asked for with "show earlier/later".
  const base = useMemo(() => {
    const list: number[] = [];
    for (let w = first; w <= last; w++) list.push(w);
    if (first > 0 && (lineStart ?? 1) - first * WINDOW < 40) list.unshift(first - 1);
    return list;
  }, [first, last, lineStart]);

  const firstQuery = useQueries({
    queries: [sourceContentQueryOptions(sourceId, windowQuery(path, base[0]!))],
  })[0]!;
  const lineCount =
    firstQuery.data && 'lines' in firstQuery.data ? firstQuery.data.lineCount : undefined;

  const windows = useMemo(() => {
    const set = new Set(base);
    if (lineCount !== undefined && lineCount <= LOAD_WHOLE) {
      for (let w = 0; w * WINDOW < lineCount; w++) set.add(w);
    }
    if (extra?.key === key) extra.windows.forEach((w) => set.add(w));
    return [...set].sort((a, b) => a - b);
  }, [base, lineCount, extra, key]);

  const results = useQueries({
    queries: windows.map((w) => sourceContentQueryOptions(sourceId, windowQuery(path, w))),
  });

  // Only a contiguous run of loaded windows is shown, so line numbers never jump.
  const lines = useMemo(() => {
    const out: Line[] = [];
    for (const r of results) {
      if (!r.data || !('lines' in r.data)) {
        if (out.length) break;
        continue;
      }
      if (out.length && r.data.lineStart !== out[out.length - 1]!.n + 1) break;
      out.push(...r.data.lines);
    }
    return out;
  }, [results]);

  const language = firstQuery.data && 'lines' in firstQuery.data ? firstQuery.data.language : null;
  const code = lines.length ? lines.map((l) => l.text).join('\n') : undefined;
  const tokens = useHighlight(code, languageFor(path, language));
  const loading = results.some((r) => r.isPending);
  const error = results.find((r) => r.isError);

  const add = (w: number) =>
    setExtra((prev) => ({
      key,
      windows: [...(prev?.key === key ? prev.windows : []), w],
    }));
  const firstShown = lines[0]?.n;
  const lastShown = lines[lines.length - 1]?.n;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CodeBar sourceId={sourceId} path={path} lineCount={lineCount} />
      {loading && <ProgressRule label={s.loading} />}
      {error && !lines.length ? (
        <ViewError error={error.error} onRetry={() => error.refetch()} />
      ) : (
        <Lines
          lines={lines}
          tokens={tokens}
          lineStart={lineStart}
          lineEnd={lineEnd ?? lineStart}
          before={
            firstShown !== undefined && firstShown > 1 ? (
              <MoreButton onClick={() => add(windowOf(firstShown) - 1)}>{s.earlier}</MoreButton>
            ) : null
          }
          after={
            lastShown !== undefined && lineCount !== undefined && lastShown < lineCount ? (
              <MoreButton onClick={() => add(windowOf(lastShown) + 1)}>{s.later}</MoreButton>
            ) : null
          }
        />
      )}
    </div>
  );
}

function windowQuery(path: string, w: number) {
  return { path, lineStart: w * WINDOW + 1, lineEnd: (w + 1) * WINDOW };
}

function MoreButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <div className="px-3 py-1.5">
      <Button variant="ghost" size="sm" onClick={onClick}>
        {children}
      </Button>
    </div>
  );
}

function CodeBar({
  sourceId,
  path,
  lineCount,
}: {
  sourceId: string;
  path: string;
  lineCount?: number;
}) {
  const navigate = useNavigate();
  const { workspaceId } = useParams({ strict: false }) as { workspaceId?: string };
  const parts = path.split('/');

  const toGraph = (direction: 'callers' | 'dependencies') => {
    if (!workspaceId) return;
    void navigate({
      to: '/w/$workspaceId/graph',
      params: { workspaceId },
      // The graph lists this file's symbols to start from; the viewer params stay so the
      // file remains open beside it.
      search: (prev) => ({ ...prev, repo: sourceId, src: sourceId, path, dir: direction }),
    });
  };

  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-3 py-1.5">
      <nav aria-label="File path" className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="px-0.5 text-ink-3/70">/</span>}
            <span className={i === parts.length - 1 ? 'text-ink' : undefined}>{part}</span>
          </span>
        ))}
        {lineCount !== undefined && <span className="ml-2">· {s.linesOf(lineCount)}</span>}
      </nav>
      {workspaceId && (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => toGraph('callers')}>
            {s.callers}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toGraph('dependencies')}>
            {s.dependencies}
          </Button>
        </div>
      )}
    </div>
  );
}

function Lines({
  lines,
  tokens,
  lineStart,
  lineEnd,
  before,
  after,
}: {
  lines: Line[];
  tokens?: Token[][];
  lineStart?: number;
  lineEnd?: number;
  before: ReactNode;
  after: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = lines.length > VIRTUALIZE_ABOVE;
  const cited = (n: number) =>
    lineStart !== undefined && n >= lineStart && n <= (lineEnd ?? lineStart);
  const gutter = `${String(lines[lines.length - 1]?.n ?? 1).length + 1}ch`;

  // Read during render only, so the compiler skipping this component is fine.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtual ? lines.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 30,
  });

  // Bring the cited lines into view once they are on screen.
  const target = lineStart !== undefined ? lines.findIndex((l) => l.n === lineStart) : -1;
  useEffect(() => {
    if (target < 0) return;
    if (virtual) {
      virtualizer.scrollToIndex(target, { align: 'center' });
    } else {
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-line="${lines[target]!.n}"]`)
        ?.scrollIntoView({ block: 'center' });
    }
    // Scroll once per target, not on every highlight pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, virtual]);

  const row = (i: number, style?: CSSProperties) => {
    const line = lines[i]!;
    return (
      <div
        key={line.n}
        data-line={line.n}
        style={style}
        className={cn('flex', cited(line.n) && 'bg-highlight')}
      >
        <span
          aria-hidden
          style={{ width: gutter }}
          className="shrink-0 pr-3 text-right text-ink-3 select-none"
        >
          {line.n}
        </span>
        <span className="pr-4 whitespace-pre">
          {tokens?.[i] ? renderTokens(tokens[i]) : line.text || ' '}
        </span>
      </div>
    );
  };

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      {before}
      <div
        className="cb-code min-w-fit py-2 font-mono text-xs leading-5 text-ink"
        role="region"
        aria-label="Code"
      >
        {virtual ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) =>
              row(item.index, {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: LINE_HEIGHT,
                transform: `translateY(${item.start}px)`,
              }),
            )}
          </div>
        ) : (
          lines.map((_, i) => row(i))
        )}
      </div>
      {after}
    </div>
  );
}

function renderTokens(line: Token[]) {
  if (!line.length) return ' ';
  return line.map(([text, light, dark, fontStyle], i) => (
    <span
      key={i}
      className="t"
      data-i={fontStyle & 1 ? '' : undefined}
      style={{ '--l': light || undefined, '--d': dark || undefined } as CSSProperties}
    >
      {text}
    </span>
  ));
}
