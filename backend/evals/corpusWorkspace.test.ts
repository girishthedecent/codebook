import { beforeEach, describe, expect, it } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { resetDb } from '../tests/helpers/db.js';
import {
  corpusSpecSchema,
  corpusVersion,
  ensureEvalUser,
  ensureEvalWorkspace,
  estimateEmbeddings,
  isSpecSource,
  loadCorpus,
  loadCorpusSpec,
  sourcesFor,
  workspaceName,
  type CorpusSource,
} from './corpusWorkspace.js';

const spec = loadCorpusSpec('core');
const entry = (key: string) => spec.sources.find((source) => source.sourceKey === key)!;
const REF = '1c6f1b0fe4000977b9a7b4f34097e4d527dd9824';

describe('the corpus spec', () => {
  it('parses datasets/corpus.json, leaving the book out of the no-context variant', () => {
    expect(spec.sources.map((source) => source.sourceKey)).toEqual(['book', 'repo', 'docs']);
    expect(sourcesFor(spec, 'context')).toHaveLength(3);
    expect(sourcesFor(spec, 'nocontext').map((source) => source.sourceKey)).toEqual([
      'repo',
      'docs',
    ]);
  });

  it('refuses a repeated sourceKey and a repository ref that is not a commit', () => {
    const repo = { sourceKey: 'repo', type: 'GITHUB_REPO', title: 'a/b' };
    const twice = {
      dataset: 'core',
      sources: [
        { ...repo, location: { url: 'https://github.com/a/b', ref: REF } },
        { ...repo, location: { url: 'https://github.com/a/c', ref: REF } },
      ],
    };
    expect(corpusSpecSchema.safeParse(twice).success).toBe(false);

    const branch = {
      dataset: 'core',
      sources: [{ ...repo, location: { url: 'https://github.com/a/b', ref: 'main' } }],
    };
    expect(corpusSpecSchema.safeParse(branch).success).toBe(false);
  });

  it('refuses another dataset name', () => {
    expect(() => loadCorpusSpec('other')).toThrow(/describes "core"/);
  });

  it('leaves the book out of the gate variant, which has its own workspace', () => {
    expect(sourcesFor(spec, 'gate').map((source) => source.sourceKey)).not.toContain('book');
    expect(workspaceName('core', 'gate')).toBe('eval-core-gate');
    expect(workspaceName('core', 'context')).toBe('eval-core');
  });

  it("doesn't change the gate's version when only the book changes", () => {
    const book = spec.sources.find((source) => source.sourceKey === 'book');
    if (!book) return;
    const moved = {
      ...spec,
      sources: spec.sources.map((source) =>
        source === book ? { ...book, title: 'Another edition' } : source,
      ),
    };
    expect(corpusVersion(moved, 'gate')).toBe(corpusVersion(spec, 'gate'));
    expect(corpusVersion(moved, 'context')).not.toBe(corpusVersion(spec, 'context'));
  });

  it("doesn't change any variant's version when a source joins another variant", () => {
    const widened = {
      ...spec,
      sources: spec.sources.map((source) =>
        source.sourceKey === 'book'
          ? { ...source, variants: [...source.variants, 'gate' as const] }
          : source,
      ),
    };
    expect(corpusVersion(widened, 'context')).toBe(corpusVersion(spec, 'context'));
    expect(corpusVersion(widened, 'nocontext')).toBe(corpusVersion(spec, 'nocontext'));
    // The variant the book joined does change: it has another source now.
    expect(corpusVersion(widened, 'gate')).not.toBe(corpusVersion(spec, 'gate'));
  });

  it('has a corpus version per variant that only changes with the spec', () => {
    expect(corpusVersion(spec, 'context')).toBe(corpusVersion(spec, 'context'));
    expect(corpusVersion(spec, 'context')).not.toBe(corpusVersion(spec, 'nocontext'));
    const moved = { ...spec, sources: spec.sources.slice(1) };
    expect(corpusVersion(moved, 'context')).not.toBe(corpusVersion(spec, 'context'));
  });
});

describe('isSpecSource', () => {
  it('matches a repository by owner, name (any case) and commit', () => {
    const origin = { owner: 'ExpressJS', repo: 'Express', ref: REF, defaultBranch: 'master' };
    expect(isSpecSource(entry('repo'), { type: 'GITHUB_REPO', title: 'x', origin })).toBe(true);
    expect(
      isSpecSource(entry('repo'), {
        type: 'GITHUB_REPO',
        title: 'x',
        origin: { ...origin, ref: 'master' },
      }),
    ).toBe(false);
  });

  it('matches a web page by its URL, whatever its title became', () => {
    const row = {
      type: 'WEBSITE' as const,
      title: 'Something else',
      origin: { url: 'https://expressjs.com/en/guide/routing.html', maxDepth: 0, maxPages: 1 },
    };
    expect(isSpecSource(entry('docs'), row)).toBe(true);
    expect(isSpecSource(entry('docs'), { ...row, origin: { url: 'https://expressjs.com/' } })).toBe(
      false,
    );
  });

  it('matches a PDF by its file name or title, and never across types', () => {
    const origin = { fileName: 'ddia.pdf', storageKey: 'k' };
    const book = entry('book');
    expect(isSpecSource(book, { type: 'PDF', title: 'x', origin })).toBe(true);
    expect(isSpecSource(book, { type: 'PDF', title: 'x', origin: {} })).toBe(false);
    expect(isSpecSource(book, { type: 'WEBSITE', title: 'x', origin })).toBe(false);
    // Uploaded under its original file name.
    const renamed = { fileName: 'Designing Data-Intensive Applications.pdf' };
    expect(isSpecSource(book, { type: 'PDF', title: book.title, origin: renamed })).toBe(true);
  });

  it('matches a PDF by its bytes when the local file is there', () => {
    const row = { type: 'PDF' as const, title: 'x', origin: {}, dedupeKey: 'pdf:abc' };
    expect(isSpecSource(entry('book'), row, 'pdf:abc')).toBe(true);
    // Same name, other bytes.
    const other = { ...row, title: entry('book').title, dedupeKey: 'pdf:def' };
    expect(isSpecSource(entry('book'), other, 'pdf:abc')).toBe(false);
  });

  it('takes any PDF file name without a path', () => {
    const pdf = (file: string) =>
      corpusSpecSchema.safeParse({
        dataset: 'core',
        sources: [{ sourceKey: 'book', type: 'PDF', title: 'B', location: { file } }],
      }).success;
    expect(pdf('Designing Data-Intensive Applications.PDF')).toBe(true);
    expect(pdf('../secret.pdf')).toBe(false);
    expect(pdf('a/b.pdf')).toBe(false);
    expect(pdf('.hidden.pdf')).toBe(false);
  });
});

describe('estimateEmbeddings', () => {
  const book = entry('book');
  const twin = { title: book.title, chunks: 924, missingContexts: 3 };

  it('expects cache hits for a same-titled copy with contexts, except its missing contexts', () => {
    expect(estimateEmbeddings(book, 'context', twin)).toBe(3);
  });

  it('expects every chunk to be new without contexts or under another title', () => {
    expect(estimateEmbeddings(book, 'nocontext', twin)).toBe(924);
    expect(estimateEmbeddings(book, 'context', { ...twin, title: 'DDIA' })).toBe(924);
  });

  it('has nothing to go by without an indexed copy', () => {
    expect(estimateEmbeddings(book as CorpusSource, 'context', null)).toBeNull();
  });
});

describe('the eval workspace', () => {
  beforeEach(resetDb);

  it('creates one system user and one workspace per variant, idempotently', async () => {
    const user = await ensureEvalUser();
    expect(user).toMatchObject({ isSystem: true, email: 'eval@codebook.local' });
    expect((await ensureEvalUser()).id).toBe(user.id);
    expect(await prismaClient.account.count()).toBe(0);

    const plain = await ensureEvalWorkspace(user.id, 'core', 'context');
    const bare = await ensureEvalWorkspace(user.id, 'core', 'nocontext');
    expect(plain).toMatchObject({ name: 'eval-core', settings: {} });
    expect(bare).toMatchObject({
      name: 'eval-core-nocontext',
      settings: { contextualRetrieval: false },
    });
    expect((await ensureEvalWorkspace(user.id, 'core', 'nocontext')).id).toBe(bare.id);
  });

  it('turns an existing user of that email into the system user, unless it can sign in', async () => {
    const existing = await prismaClient.user.create({
      data: { id: 'u-eval', name: 'Me', email: 'eval@codebook.local', isSystem: false },
    });
    expect(await ensureEvalUser()).toMatchObject({ id: existing.id, isSystem: true });

    await prismaClient.account.create({
      data: {
        id: 'a-eval',
        accountId: existing.id,
        providerId: 'credential',
        userId: existing.id,
        password: 'hash',
      },
    });
    await expect(ensureEvalUser()).rejects.toThrow(/has a password/);
  });

  it('loads the corpus with each sourceKey mapped to its source', async () => {
    await expect(loadCorpus('core', 'nocontext')).rejects.toThrow(/--variant nocontext/);

    const user = await ensureEvalUser();
    const workspace = await ensureEvalWorkspace(user.id, 'core', 'nocontext');
    const repo = await prismaClient.source.create({
      data: {
        workspaceId: workspace.id,
        type: 'GITHUB_REPO',
        title: entry('repo').title,
        status: 'READY',
        origin: { owner: 'expressjs', repo: 'express', ref: REF, defaultBranch: 'master' },
        dedupeKey: `github:expressjs/express@${REF}`,
      },
    });
    await expect(loadCorpus('core', 'nocontext')).rejects.toThrow(/missing docs/);

    const docs = await prismaClient.source.create({
      data: {
        workspaceId: workspace.id,
        type: 'WEBSITE',
        title: 'Routing · Express.js',
        origin: { url: 'https://expressjs.com/en/guide/routing.html', maxDepth: 0, maxPages: 1 },
        dedupeKey: 'web:https://expressjs.com/en/guide/routing.html',
      },
    });

    const corpus = await loadCorpus('core', 'nocontext');
    expect(corpus).toMatchObject({
      userId: user.id,
      workspaceId: workspace.id,
      corpusVersion: corpusVersion(spec, 'nocontext'),
    });
    expect(corpus.sources).toEqual([
      { sourceKey: 'repo', sourceId: repo.id, type: 'GITHUB_REPO', status: 'READY' },
      { sourceKey: 'docs', sourceId: docs.id, type: 'WEBSITE', status: 'PENDING' },
    ]);
  });
});
