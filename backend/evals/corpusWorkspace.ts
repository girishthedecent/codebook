import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import type { SourceStatus, SourceType } from '../src/generated/prisma/enums.js';
import { sha256 } from '../src/utils/hash.js';

// Where an eval corpus lives: one system user, a workspace per dataset and variant (with and
// without contextual retrieval) and the sources listed in datasets/corpus.json. The runner
// reads it with loadCorpus; `pnpm evals:corpus` builds it.

export type CorpusVariant = 'context' | 'nocontext';
export const CORPUS_VARIANTS = ['context', 'nocontext'] as const;

export const EVAL_USER_EMAIL = 'eval@codebook.local';

const SOURCE_KEYS = ['book', 'repo', 'docs'] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

// `title` is the title the source ends up with (a web page's <title>, the service's name for
// a repository). It is part of every embedding input, so it must match the copy the caches
// were filled from. `variants` leaves a source out of a variant: the book without contexts
// would need all its chunks embedded again, most of a day's free quota.
const common = {
  sourceKey: z.enum(SOURCE_KEYS),
  title: z.string().trim().min(1).max(200),
  variants: z
    .array(z.enum(CORPUS_VARIANTS))
    .min(1)
    .default([...CORPUS_VARIANTS]),
};

const corpusSourceSchema = z.discriminatedUnion('type', [
  z.object({
    ...common,
    type: z.literal('PDF'),
    // A file name in evals/corpus/ (gitignored: books are usually copyrighted). Any name
    // without a path in it.
    location: z.object({ file: z.string().regex(/^(?!\.)[^/\\\0]+\.pdf$/i) }),
  }),
  z.object({
    ...common,
    type: z.literal('GITHUB_REPO'),
    // A commit, so the corpus never moves under the golden refs.
    location: z.object({ url: z.url(), ref: z.string().regex(/^[0-9a-f]{40}$/) }),
  }),
  z.object({
    ...common,
    type: z.literal('WEBSITE'),
    location: z.object({
      url: z.url(),
      maxDepth: z.int().min(0),
      maxPages: z.int().min(1),
    }),
  }),
]);

export const corpusSpecSchema = z.object({
  dataset: z.string().regex(/^[a-z0-9-]+$/),
  sources: z
    .array(corpusSourceSchema)
    .min(1)
    .refine(
      (sources) => new Set(sources.map((s) => s.sourceKey)).size === sources.length,
      'Each sourceKey can only appear once',
    ),
});

export type CorpusSpec = z.infer<typeof corpusSpecSchema>;
export type CorpusSource = CorpusSpec['sources'][number];

export const corpusDir = new URL('./corpus/', import.meta.url);

export function loadCorpusSpec(dataset: string): CorpusSpec {
  const file = new URL('./datasets/corpus.json', import.meta.url);
  const spec = corpusSpecSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (spec.dataset !== dataset) {
    throw new Error(`datasets/corpus.json describes "${spec.dataset}", not "${dataset}"`);
  }
  return spec;
}

export function sourcesFor(spec: CorpusSpec, variant: CorpusVariant) {
  return spec.sources.filter((source) => source.variants.includes(variant));
}

export function workspaceName(dataset: string, variant: CorpusVariant) {
  return variant === 'context' ? `eval-${dataset}` : `eval-${dataset}-nocontext`;
}

/** Changes whenever the corpus or the way it is ingested changes; every run records it. */
export function corpusVersion(spec: CorpusSpec, variant: CorpusVariant) {
  const { version, graph, website, repo } = appConfig.ingestion;
  const versions = {
    ingest: version,
    graph: graph.version,
    website: website.version,
    scanner: repo.scannerVersion,
  };
  return sha256(JSON.stringify(spec), variant, JSON.stringify(versions)).slice(0, 16);
}

/** The URL as the sources service stores it (no fragment). */
const normalizeUrl = (url: string) => {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
};

type SourceRow = { type: SourceType; title: string; origin: unknown; dedupeKey?: string };

/**
 * Whether a source row is this spec entry. Origins, not titles, where they identify it: a web
 * page's title changes. A PDF is its bytes (`pdfKey`, the dedupe key of the local file, when
 * there is one); without the file, an upload of the same file name or title.
 */
export function isSpecSource(entry: CorpusSource, row: SourceRow, pdfKey?: string) {
  if (row.type !== entry.type) return false;
  const origin = (row.origin ?? {}) as Record<string, unknown>;
  switch (entry.type) {
    case 'PDF':
      if (pdfKey) return row.dedupeKey === pdfKey;
      return origin.fileName === entry.location.file || row.title === entry.title;
    case 'GITHUB_REPO': {
      const [owner, repo] = new URL(entry.location.url).pathname.slice(1).split('/');
      return (
        String(origin.owner).toLowerCase() === owner?.toLowerCase() &&
        String(origin.repo).toLowerCase() === repo?.replace(/\.git$/, '').toLowerCase() &&
        origin.ref === entry.location.ref
      );
    }
    case 'WEBSITE':
      return origin.url === normalizeUrl(entry.location.url);
  }
}

/** The book's path in evals/corpus/. */
export function bookPath(entry: Extract<CorpusSource, { type: 'PDF' }>) {
  return fileURLToPath(new URL(entry.location.file, corpusDir));
}

/** The dedupe key the sources service gives the local copy of the book, if it is there. */
export async function localPdfKey(entry: CorpusSource) {
  if (entry.type !== 'PDF') return undefined;
  const path = bookPath(entry);
  if (!existsSync(path)) return undefined;
  return `pdf:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}

/**
 * The system user that owns the eval workspaces. It has no password, so nobody signs in; an
 * account of that email that can sign in (registered by hand in dev) is refused.
 */
export async function ensureEvalUser() {
  const user = await prismaClient.user.upsert({
    where: { email: EVAL_USER_EMAIL },
    update: { isSystem: true },
    create: {
      id: randomUUID(),
      name: 'Eval runner',
      email: EVAL_USER_EMAIL,
      emailVerified: true,
      isSystem: true,
    },
  });
  const login = await prismaClient.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  });
  if (login) {
    throw new Error(`${EVAL_USER_EMAIL} has a password; delete that user before running evals`);
  }
  return user;
}

/** The variant's workspace; contextual retrieval off for `nocontext` (an internal setting). */
export async function ensureEvalWorkspace(userId: string, dataset: string, variant: CorpusVariant) {
  const name = workspaceName(dataset, variant);
  const settings = variant === 'nocontext' ? { contextualRetrieval: false } : {};
  const existing = await prismaClient.workspace.findFirst({ where: { userId, name } });
  if (!existing) {
    return prismaClient.workspace.create({
      data: { userId, name, description: `Eval corpus "${dataset}" (${variant})`, settings },
    });
  }
  if (JSON.stringify(existing.settings) !== JSON.stringify(settings)) {
    return prismaClient.workspace.update({ where: { id: existing.id }, data: { settings } });
  }
  return existing;
}

export type CorpusSourceRef = {
  sourceKey: SourceKey;
  sourceId: string;
  type: SourceType;
  status: SourceStatus;
};

export type Corpus = {
  userId: string;
  workspaceId: string;
  corpusVersion: string;
  sources: CorpusSourceRef[];
};

/** The built corpus of a dataset and variant. Throws when it hasn't been built. */
export async function loadCorpus(dataset: string, variant: CorpusVariant): Promise<Corpus> {
  const spec = loadCorpusSpec(dataset);
  const name = workspaceName(dataset, variant);
  const user = await prismaClient.user.findUnique({ where: { email: EVAL_USER_EMAIL } });
  const workspace =
    user && (await prismaClient.workspace.findFirst({ where: { userId: user.id, name } }));
  if (!user || !workspace) {
    const flag = variant === 'nocontext' ? ' -- --no-context' : '';
    throw new Error(`No eval workspace "${name}": run pnpm evals:corpus${flag} first`);
  }

  const rows = await prismaClient.source.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true, type: true, title: true, origin: true, status: true, dedupeKey: true },
  });
  const sources: CorpusSourceRef[] = [];
  const missing: string[] = [];
  for (const entry of sourcesFor(spec, variant)) {
    const pdfKey = await localPdfKey(entry);
    const row = rows.find((candidate) => isSpecSource(entry, candidate, pdfKey));
    if (row) {
      sources.push({
        sourceKey: entry.sourceKey,
        sourceId: row.id,
        type: row.type,
        status: row.status,
      });
    } else {
      missing.push(entry.sourceKey);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Eval workspace "${name}" is missing ${missing.join(', ')}: run evals:corpus`);
  }

  return {
    userId: user.id,
    workspaceId: workspace.id,
    corpusVersion: corpusVersion(spec, variant),
    sources,
  };
}

/** An already indexed copy of a spec source elsewhere, whose caches a new ingest reuses. */
export type Twin = { chunks: number; missingContexts: number; title: string };

/**
 * New embeddings an ingest of `entry` is likely to need. With contexts and a twin of the same
 * title, the contexts and vectors come from the caches (only the twin's missing contexts get
 * new text); without contexts every chunk's text is new. Null when there is nothing to go by.
 */
export function estimateEmbeddings(
  entry: CorpusSource,
  variant: CorpusVariant,
  twin: Twin | null,
): number | null {
  if (!twin) return null;
  if (variant === 'nocontext') return twin.chunks;
  return twin.title === entry.title ? twin.missingContexts : twin.chunks;
}

/** A READY copy of the spec source outside the eval workspaces, with its chunk counts. */
export async function findTwin(entry: CorpusSource, evalUserId: string) {
  const rows = await prismaClient.source.findMany({
    where: { type: entry.type, status: 'READY', workspace: { userId: { not: evalUserId } } },
    select: { title: true, origin: true, stats: true, type: true, dedupeKey: true },
  });
  const pdfKey = await localPdfKey(entry);
  const row = rows.find((candidate) => isSpecSource(entry, candidate, pdfKey));
  if (!row) return null;
  const stats = row.stats as { chunks?: number; missingContexts?: number };
  return {
    title: row.title,
    chunks: stats.chunks ?? 0,
    missingContexts: stats.missingContexts ?? 0,
  } satisfies Twin;
}
