import type { Source, SourceStage, SourceType } from '@/api/types';
import { displayTitle } from '@/lib/displayTitle';
import { hostOf } from './sourceMeta';

// The fields of `stats` and `origin` this app reads. The API types them as loose records
// because they differ by source type.
export type PdfStats = { pages?: number; chunks?: number };
export type RepoStats = {
  files?: number;
  skippedFiles?: number;
  commitSha?: string;
  languages?: Record<string, number>;
  graph?: { symbols?: number; edges?: number };
};
export type SiteStats = { pages?: number; skippedPages?: number; robotsBlocked?: number };

export type PdfOrigin = { fileName?: string; size?: number };
export type RepoOrigin = { owner?: string; repo?: string; ref?: string; defaultBranch?: string };
export type SiteOrigin = { url?: string; maxDepth?: number; maxPages?: number };

export const statsOf = <T>(source: Source) => source.stats as T;
export const originOf = <T>(source: Source) => source.origin as T;

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "31 Oct", or "31 Oct 2025" when it isn't this year. */
export function shortDate(iso: string) {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: thisYear ? undefined : 'numeric',
  });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The line under a title: what was indexed and when, in words and figures. */
export function colophon(source: Source): string {
  const indexed = source.lastIngestedAt ? `indexed ${shortDate(source.lastIngestedAt)}` : '';
  switch (source.type) {
    case 'PDF': {
      const { pages } = statsOf<PdfStats>(source);
      return [pages ? plural(pages, 'page') : '', indexed].filter(Boolean).join(' · ');
    }
    case 'GITHUB_REPO': {
      const stats = statsOf<RepoStats>(source);
      const sha = stats.commitSha?.slice(0, 7);
      return [
        stats.files ? plural(stats.files, 'file') : '',
        stats.graph?.symbols ? plural(stats.graph.symbols, 'symbol') : '',
        sha ? `commit ${sha}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    case 'WEBSITE': {
      const { pages } = statsOf<SiteStats>(source);
      const host = hostOf(originOf<SiteOrigin>(source).url);
      return [host, pages ? plural(pages, 'page') : '', indexed].filter(Boolean).join(' · ');
    }
  }
}

/** The name to put in a list: a repository's commit is cut to seven characters. */
export function nameOf(source: Pick<Source, 'title' | 'type'>) {
  return displayTitle(source);
}

/** Up to three languages of a repository, most files first: "JavaScript, Markdown and YAML". */
export function mainLanguages(source: Source): string {
  const languages = statsOf<RepoStats>(source).languages ?? {};
  const top = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  if (top.length < 2) return top[0] ?? '';
  return `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`;
}

// ---- indexing progress ----------------------------------------------------------------

// The stages each kind of source goes through, in order; QUEUED and DONE are not steps.
const steps: Record<SourceType, SourceStage[]> = {
  PDF: [
    'FETCHING',
    'PARSING',
    'STRUCTURING',
    'CHUNKING',
    'CONTEXTUALIZING',
    'EMBEDDING',
    'INDEXING',
  ],
  GITHUB_REPO: [
    'FETCHING',
    'FILTERING',
    'PARSING',
    'CHUNKING',
    'STRUCTURING',
    'CONTEXTUALIZING',
    'EMBEDDING',
    'INDEXING',
  ],
  WEBSITE: ['FETCHING', 'CHUNKING', 'CONTEXTUALIZING', 'EMBEDDING', 'INDEXING'],
};

const stageWords: Record<SourceStage, string> = {
  QUEUED: 'Waiting to start',
  FETCHING: 'Fetching',
  FILTERING: 'Choosing what to read',
  PARSING: 'Reading',
  STRUCTURING: 'Reading the structure',
  CHUNKING: 'Splitting it into passages',
  CONTEXTUALIZING: 'Adding context to each passage',
  EMBEDDING: 'Making it searchable',
  INDEXING: 'Saving the index',
  DONE: 'Finishing up',
};

const stageWordsByType: Partial<Record<SourceType, Partial<Record<SourceStage, string>>>> = {
  PDF: { FETCHING: 'Opening the file', PARSING: 'Reading the pages' },
  GITHUB_REPO: {
    FETCHING: 'Downloading the repository',
    PARSING: 'Reading the files',
    STRUCTURING: 'Mapping symbols and calls',
  },
  WEBSITE: { FETCHING: 'Fetching the page' },
};

/** "Reading the structure, 4 of 7": where indexing is, in words. */
export function stageLine(source: Pick<Source, 'type' | 'status' | 'stage'>): string {
  if (source.status === 'PENDING') return stageWords.QUEUED;
  const words = stageWordsByType[source.type]?.[source.stage] ?? stageWords[source.stage];
  const list = steps[source.type];
  const at = list.indexOf(source.stage);
  return at === -1 ? words : `${words}, ${at + 1} of ${list.length}`;
}

// Past these the backend lets a resync take over (config.sources.stale*Ms).
const STALE_MINUTES = { PENDING: 10, PROCESSING: 30 } as const;

/** How many minutes a queued or running source has been quiet, once that is too long. */
export function stuckMinutes(source: Pick<Source, 'status' | 'updatedAt'>, now: number) {
  if (source.status !== 'PENDING' && source.status !== 'PROCESSING') return undefined;
  const idle = Math.floor((now - Date.parse(source.updatedAt)) / 60_000);
  return idle > STALE_MINUTES[source.status] ? idle : undefined;
}

export function idleText(minutes: number) {
  if (minutes < 120) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hours`;
}

// ---- failures -------------------------------------------------------------------------

// The backend stores a short message with each failure; these few are written for logs more
// than for readers, so they get a plainer sentence. Anything else is shown as it is.
const failures: Array<[RegExp, string]> = [
  [
    /^Processing failed/,
    'Something went wrong while indexing this. Try again, and add it again if it keeps failing.',
  ],
  [
    /Creating embeddings failed/,
    'The service that makes the text searchable has reached its daily limit. Try again later; what was finished is kept.',
  ],
  [/Could not queue/, "It couldn't be put in line for indexing. Try again."],
  [/^Embeddings missing/, 'Part of the index could not be saved. Try again.'],
];

export function failureText(source: Pick<Source, 'error'>): string {
  const raw = source.error?.trim();
  if (!raw) return 'Indexing failed.';
  return failures.find(([pattern]) => pattern.test(raw))?.[1] ?? raw;
}
