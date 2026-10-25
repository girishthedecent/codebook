import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { generateObject } from '../src/llm/client.js';
import { resetDb } from '../tests/helpers/db.js';
import { seedSource } from '../tests/helpers/retrieval.js';
import {
  candidateId,
  failureCandidates,
  importAccepted,
  mergeAccepted,
  refOf,
  synthesizeCandidates,
  type Candidate,
} from './candidates.js';

vi.mock('../src/llm/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/llm/client.js')>()),
  generateObject: vi.fn(),
}));
vi.mock('../src/utils/pacer.js', () => import('../tests/helpers/no-pacing.js'));

const generateMock = vi.mocked(generateObject);

const parentAt = (fields: Partial<Parameters<typeof refOf>[1]>) => ({
  headingPath: [],
  pageStart: null,
  pageEnd: null,
  lineStart: null,
  lineEnd: null,
  document: { path: 'lib/router.js' },
  ...fields,
});

describe('refOf', () => {
  it('points at exactly what the passage covers', () => {
    expect(refOf('book', parentAt({ pageStart: 99, pageEnd: 100 }))).toEqual({
      sourceKey: 'book',
      pageStart: 99,
      pageEnd: 100,
    });
    expect(refOf('repo', parentAt({ lineStart: 10, lineEnd: 40 }))).toEqual({
      sourceKey: 'repo',
      path: 'lib/router.js',
      lineStart: 10,
      lineEnd: 40,
    });
    expect(
      refOf(
        'docs',
        parentAt({
          headingPath: ['Routing', 'Route paths'],
          document: { path: 'https://expressjs.com/en/guide/routing.html' },
        }),
      ),
    ).toEqual({
      sourceKey: 'docs',
      url: 'https://expressjs.com/en/guide/routing.html',
      heading: 'Route paths',
    });
  });

  it('gives no ref for a passage without a location', () => {
    expect(refOf('book', parentAt({}))).toBeNull();
    expect(refOf('repo', parentAt({}))).toBeNull();
  });
});

const synthetic = (fields: Partial<Candidate> & Record<string, unknown> = {}): Candidate => ({
  id: 'synth-book-1',
  origin: 'SYNTHETIC',
  accepted: true,
  from: { chunkId: 'chunk-1' },
  type: 'BOOK',
  split: 'DEV',
  question: 'Why add a Bloom filter to an LSM tree?',
  expectedAnswer: 'To skip reads for keys that are not there.',
  expectedRefs: [{ sourceKey: 'book', pageStart: 99, pageEnd: 99 }],
  tags: ['synthetic'],
  reviewed: false,
  ...fields,
});

const manual = {
  id: 'book-001',
  type: 'BOOK',
  split: 'DEV',
  question: 'Hand written',
  expectedAnswer: 'Written by hand.',
  expectedRefs: [{ sourceKey: 'book', pageStart: 10, pageEnd: 10 }],
  tags: [],
  reviewed: true,
};

describe('mergeAccepted', () => {
  it('adds accepted candidates as reviewed cases, never in the gate, and skips the rest', () => {
    const { cases, accepted } = mergeAccepted(
      [manual],
      [
        synthetic({ tags: ['synthetic', 'gate'] }),
        synthetic({ id: 'synth-book-2', accepted: false }),
      ],
    );

    expect(accepted).toBe(1);
    expect(cases).toHaveLength(2);
    expect(cases[0]).toBe(manual);
    expect(cases[1]).toEqual({
      id: 'synth-book-1',
      origin: 'SYNTHETIC',
      type: 'BOOK',
      split: 'DEV',
      question: 'Why add a Bloom filter to an LSM tree?',
      expectedAnswer: 'To skip reads for keys that are not there.',
      expectedRefs: [{ sourceKey: 'book', pageStart: 99, pageEnd: 99 }],
      tags: ['synthetic'],
      reviewed: true,
    });
  });

  it('replaces a case it imported before, but not a hand-written one with the same id', () => {
    const before = mergeAccepted([manual], [synthetic()]).cases;
    const again = mergeAccepted(before as { id: string }[], [
      synthetic({ question: 'Edited question?' }),
    ]);
    expect(again.cases).toHaveLength(2);
    expect(again.cases[1]).toMatchObject({ question: 'Edited question?' });

    expect(() => mergeAccepted([manual], [synthetic({ id: 'book-001' })])).toThrow(
      /already has a MANUAL case/,
    );
  });

  it('refuses one id accepted twice, even from the same origin', () => {
    expect(() =>
      mergeAccepted([], [synthetic(), synthetic({ question: 'Same id again?' })]),
    ).toThrow(/synth-book-1: accepted twice/);
  });

  it('checks the whole merged file, not just the new cases', () => {
    const broken = { id: 'book-002', type: 'BOOK' };
    expect(() => mergeAccepted([broken], [synthetic()])).toThrow(/would not be valid/);
  });

  it('refuses an accepted candidate whose placeholders were not filled in', () => {
    const failure = synthetic({
      id: 'failure-1',
      origin: 'FAILURE',
      type: null,
      expectedAnswer: '',
      expectedRefs: [],
    });
    expect(() => mergeAccepted([], [failure])).toThrow(/failure-1/);
  });
});

describe('failureCandidates', () => {
  let users: { alice: string; bob: string };
  let workspaces: { alice: string; aliceOther: string; bob: string };

  async function conversationWith(
    userId: string,
    workspaceId: string,
    answer: Record<string, unknown>,
  ) {
    const conversation = await prismaClient.conversation.create({
      data: { userId, workspaceId, title: 'chat' },
    });
    const at = Date.now();
    await prismaClient.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: `Question in ${workspaceId}`,
        createdAt: new Date(at),
      },
    });
    return prismaClient.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: 'x'.repeat(1_000),
        createdAt: new Date(at + 1),
        ...answer,
      },
    });
  }

  beforeEach(async () => {
    await resetDb();
    const make = async (name: string) => {
      const user = await prismaClient.user.create({
        data: { id: `user-${name}`, name, email: `${name}@example.com` },
      });
      return user.id;
    };
    users = { alice: await make('alice'), bob: await make('bob') };
    const workspace = async (userId: string, name: string) =>
      (await prismaClient.workspace.create({ data: { userId, name } })).id;
    workspaces = {
      alice: await workspace(users.alice, 'Books'),
      aliceOther: await workspace(users.alice, 'Code'),
      bob: await workspace(users.bob, 'Books'),
    };
  });

  it('takes failed answers from one workspace only, with the question and an excerpt', async () => {
    const down = await conversationWith(users.alice, workspaces.alice, {
      feedback: 'DOWN',
      feedbackNote: 'wrong page',
      invalidCitations: 2,
    });
    await conversationWith(users.alice, workspaces.alice, { feedback: 'UP' });
    await conversationWith(users.alice, workspaces.aliceOther, { weakRetrieval: true });
    await conversationWith(users.bob, workspaces.bob, { feedback: 'DOWN' });

    const found = await failureCandidates({ workspaceId: workspaces.alice });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: candidateId('failure', down.id),
      origin: 'FAILURE',
      accepted: false,
      type: null,
      question: `Question in ${workspaces.alice}`,
      expectedAnswer: '',
      expectedRefs: [],
      from: {
        messageId: down.id,
        reasons: ['thumbs_down', 'invalid_citations'],
        feedbackNote: 'wrong page',
      },
    });
    expect((found[0]!.from.answerExcerpt as string).length).toBe(300);
  });

  it("takes one user's failed answers across their workspaces, and nobody else's", async () => {
    await conversationWith(users.alice, workspaces.alice, { invalidCitations: 1 });
    await conversationWith(users.alice, workspaces.aliceOther, { weakRetrieval: true });
    await conversationWith(users.bob, workspaces.bob, { weakRetrieval: true });

    const found = await failureCandidates({ userId: users.alice });

    expect(found.map((candidate) => candidate.from.workspaceId).sort()).toEqual(
      [workspaces.alice, workspaces.aliceOther].sort(),
    );
  });
});

describe('synthesizeCandidates', () => {
  let workspaceId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    generateMock.mockReset();
    userId = (
      await prismaClient.user.create({ data: { id: 'eval', name: 'eval', email: 'e@x.dev' } })
    ).id;
    workspaceId = (await prismaClient.workspace.create({ data: { userId, name: 'eval-core' } })).id;
  });

  async function seedBook() {
    const seeded = await seedSource(workspaceId, {
      parents: {
        lsm: { content: 'LSM trees and Bloom filters.', tokenCount: 400 },
        btree: { content: 'B-trees update pages in place.', tokenCount: 400 },
        toc: { content: 'Contents', tokenCount: 20 },
        index: { content: 'Index pages.', tokenCount: 400 },
      },
      chunks: {},
    });
    for (const [key, page] of [
      ['lsm', 99],
      ['btree', 80],
      ['toc', 1],
      ['index', 500],
    ] as const) {
      await prismaClient.sourceChunk.update({
        where: { id: seeded.ids[key] },
        data: { pageStart: page, pageEnd: page },
      });
    }
    return seeded;
  }

  const reply = (usable: boolean, question = 'What does a Bloom filter save?') => ({
    object: { question, answer: 'Disk reads for missing keys.', usable },
    call: {} as never,
  });

  it('drafts from long passages, skips what is not worth asking, and stops at n', async () => {
    const { sourceId, ids } = await seedBook();
    generateMock.mockImplementation(async (options) => {
      const prompt = (options as { prompt: string }).prompt;
      return reply(!prompt.includes('Index pages.')) as never;
    });

    const made = await synthesizeCandidates({
      userId,
      workspaceId,
      sourceId,
      sourceKey: 'book',
      n: 5,
      gapMs: 0,
      // Deterministic order: as listed.
      random: () => 0.999,
    });

    // The table of contents is too short to ask about; the index page wasn't usable.
    expect(generateMock).toHaveBeenCalledTimes(3);
    expect(made.map((candidate) => candidate.from.chunkId).sort()).toEqual(
      [ids.lsm, ids.btree].sort(),
    );
    const lsm = made.find((candidate) => candidate.from.chunkId === ids.lsm)!;
    expect(lsm).toMatchObject({
      origin: 'SYNTHETIC',
      accepted: false,
      type: 'BOOK',
      expectedRefs: [{ sourceKey: 'book', pageStart: 99, pageEnd: 99 }],
      tags: ['synthetic'],
      from: { location: 'page 99' },
    });
    expect(generateMock.mock.calls[0]![0]).toMatchObject({
      task: 'cheap',
      ctx: { userId, workspaceId },
    });
  });

  it('skips passages drafted before and gives up after repeated failures', async () => {
    const { sourceId, ids } = await seedBook();
    generateMock.mockRejectedValue(new Error('429 rate limited'));
    const lines: string[] = [];

    const made = await synthesizeCandidates({
      userId,
      workspaceId,
      sourceId,
      sourceKey: 'book',
      n: 5,
      gapMs: 0,
      skipChunkIds: new Set([ids.lsm!]),
      log: (line) => lines.push(line),
    });

    expect(made).toEqual([]);
    // btree and index are left; two failures don't reach the limit of three in a row.
    expect(generateMock).toHaveBeenCalledTimes(2);

    generateMock.mockClear();
    const { sourceId: other, ids: more } = await seedSource(workspaceId, {
      parents: {
        a: { content: 'A.', tokenCount: 400 },
        b: { content: 'B.', tokenCount: 400 },
        c: { content: 'C.', tokenCount: 400 },
        d: { content: 'D.', tokenCount: 400 },
      },
      chunks: {},
    });
    for (const id of Object.values(more)) {
      await prismaClient.sourceChunk.update({ where: { id }, data: { pageStart: 1, pageEnd: 1 } });
    }
    await synthesizeCandidates({
      userId,
      workspaceId,
      sourceId: other,
      sourceKey: 'book',
      n: 5,
      gapMs: 0,
      log: (line) => lines.push(line),
    });
    expect(generateMock).toHaveBeenCalledTimes(3);
    expect(lines.at(-1)).toBe('Stopping after 3 failed calls in a row');
  });
});

describe('importAccepted', () => {
  let dir: string;
  const valid = {
    id: 'book-001',
    type: 'BOOK',
    split: 'DEV',
    question: 'Hand written?',
    expectedAnswer: 'Yes.',
    expectedRefs: [{ sourceKey: 'book', pageStart: 1, pageEnd: 1 }],
    tags: ['gate'],
    reviewed: true,
  };

  beforeEach(async () => {
    await resetDb();
    dir = await mkdtemp(join(tmpdir(), 'evals-import-'));
    return () => rm(dir, { recursive: true, force: true });
  });

  async function files(candidates: Candidate[]) {
    const datasetFile = join(dir, 'core.json');
    const candidatesFile = join(dir, 'candidates.json');
    const original = `${JSON.stringify([valid], null, 2)}\n`;
    await writeFile(datasetFile, original);
    await writeFile(candidatesFile, JSON.stringify(candidates));
    return { datasetFile, candidatesFile, original };
  }

  it('imports the merged cases, then rewrites the dataset file', async () => {
    const { datasetFile, candidatesFile } = await files([synthetic()]);

    const result = await importAccepted(datasetFile, candidatesFile, 'core');

    expect(result).toMatchObject({ accepted: 1, imported: 2 });
    const written = JSON.parse(await readFile(datasetFile, 'utf8')) as { id: string }[];
    expect(written.map((item) => item.id)).toEqual(['book-001', 'synth-book-1']);
    const rows = await prismaClient.evalCase.findMany({ orderBy: { externalId: 'asc' } });
    expect(rows.map(({ externalId, origin }) => ({ externalId, origin }))).toEqual([
      { externalId: 'book-001', origin: 'MANUAL' },
      { externalId: 'synth-book-1', origin: 'SYNTHETIC' },
    ]);
  });

  it('leaves the dataset file and the database as they were when the merge is refused', async () => {
    const { datasetFile, candidatesFile, original } = await files([
      synthetic(),
      synthetic({ id: 'book-001' }),
    ]);

    await expect(importAccepted(datasetFile, candidatesFile, 'core')).rejects.toThrow(
      /already has a MANUAL case/,
    );

    expect(await readFile(datasetFile, 'utf8')).toBe(original);
    expect(await prismaClient.evalCase.count()).toBe(0);
  });
});
