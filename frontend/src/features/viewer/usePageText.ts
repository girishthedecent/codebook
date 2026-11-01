import { useQueries, useQuery } from '@tanstack/react-query';
import { sourceContentQueryOptions } from '@/api/queries';

const WINDOW = 400;
// Web pages are short; past this many windows the rest stays unloaded.
const MAX_WINDOWS = 10;

/** A stored web page as one markdown text, read a window of lines at a time. */
export function usePageText(sourceId: string, url: string) {
  const first = useQuery(
    sourceContentQueryOptions(sourceId, { path: url, lineStart: 1, lineEnd: WINDOW }),
  );
  const lineCount = first.data && 'lines' in first.data ? first.data.lineCount : undefined;
  const windowCount = Math.min(MAX_WINDOWS, Math.ceil((lineCount ?? 1) / WINDOW));

  const results = useQueries({
    queries: Array.from({ length: windowCount }, (_, w) =>
      sourceContentQueryOptions(sourceId, {
        path: url,
        lineStart: w * WINDOW + 1,
        lineEnd: (w + 1) * WINDOW,
      }),
    ),
  });

  const loaded = results.every((r) => r.data);
  const text = loaded
    ? results
        .flatMap((r) => (r.data && 'lines' in r.data ? r.data.lines.map((l) => l.text) : []))
        .join('\n')
    : undefined;
  const failed = results.find((r) => r.isError) ?? (first.isError ? first : undefined);

  return {
    text,
    loaded,
    error: failed?.error ?? undefined,
    retry: () => void (failed ?? first).refetch(),
  };
}
