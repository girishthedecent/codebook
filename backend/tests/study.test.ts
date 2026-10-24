import { InngestTestEngine } from '@inngest/test';
import type { Agent } from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { inngest } from '../src/config/inngest.config.js';
import { textRoutes } from '../src/llm/models.js';
import { search } from '../src/modules/retrieval/retrieval.service.js';
import type { SearchResult } from '../src/modules/retrieval/retrieval.types.js';
import { generateStudyArtifact } from '../src/modules/study/study.function.js';
import type { StudyInput } from '../src/modules/study/study.dto.js';
import { MAX_GROUPS } from '../src/modules/study/study.gather.js';
import { generateStudy as generateOnce } from '../src/modules/study/study.generate.js';
import { UpstreamError } from '../src/utils/errors/app.error.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { apiError, promptModel, scriptedModel, useModels } from './helpers/llm-mock.js';
import { seedSource } from './helpers/retrieval.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/modules/retrieval/retrieval.service.js', () => ({ search: vi.fn() }));

const STUDY = textRoutes.study;
const SUMMARIZE = textRoutes.summarize;

let alice: Agent;
let bob: Agent;
let workspaceId: string;
let book: Awaited<ReturnType<typeof seedSource>>;
let send: ReturnType<typeof spyOnSend>;

const spyOnSend = () => vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] } as never);

/** The prompts the study model was sent, in order. */
let prompts: string[];

/** Answers every study call with `reply(prompt, numbers)`; numbers are the <source n>s. */
function studyModel(reply: (prompt: string, numbers: number[]) => unknown) {
  const model = promptModel((prompt) => {
    prompts.push(prompt);
    const numbers = [...prompt.matchAll(/<source n="(\d+)"/g)].map((m) => Number(m[1]));
    return JSON.stringify(reply(prompt, numbers));
  });
  useModels({ [STUDY.primary!.model]: model, [STUDY.fallback!.model]: model });
}

const question = (i: number, citations: number[], options = ['A', 'B', 'C', 'D']) => ({
  question: `Question ${i}?`,
  options: options.map((option) => `${option}${i}`),
  answerIndex: 1,
  explanation: `Because ${i}.`,
  citations,
  difficulty: 'medium',
});

async function createStudy(body: Record<string, unknown>, agent = alice, workspace = workspaceId) {
  return agent.post(`/api/v1/workspaces/${workspace}/study`).send(body);
}

/** Creates a study set through the API and runs its generation in-process. */
async function generateStudy(body: Record<string, unknown>) {
  const res = await createStudy(body);
  expect(res.status, res.text).toBe(202);
  const artifactId = (res.body as { data: { id: string } }).data.id;
  await run(artifactId);
  return artifactId;
}

async function run(artifactId: string) {
  const engine = new InngestTestEngine({
    function: generateStudyArtifact,
    events: [{ name: 'study/generate.requested', data: { artifactId } }],
  });
  return engine.execute();
}

type StudyBody = {
  data: {
    status: string;
    error: string | null;
    title: string;
    data: Record<string, { citations: number[]; uncited?: true }[]> & { title: string };
    sources: { n: number; sourceTitle: string; heading?: string; snippet: string }[];
  };
};

async function getStudy(id: string, agent = alice) {
  const res = await agent.get(`/api/v1/study/${id}`);
  return { status: res.status, body: (res.body as StudyBody).data };
}

beforeEach(async () => {
  await resetDb();
  prompts = [];
  send = spyOnSend();
  ({ agent: alice } = await signedInUser('alice@example.com'));
  ({ agent: bob } = await signedInUser('bob@example.com'));
  const res = await alice.post('/api/v1/workspaces').send({ name: 'Books' });
  workspaceId = (res.body as { data: { id: string } }).data.id;

  book = await seedSource(workspaceId, {
    title: 'Data Book',
    path: 'book.pdf',
    parents: {
      intro: { content: 'Intro: why data systems matter.', tokenCount: 8, headingPath: ['Ch1'] },
      logs: {
        content: 'Logs append records in order.',
        tokenCount: 8,
        headingPath: ['Ch1', 'Logs'],
      },
      trees: {
        content: 'B-trees update pages in place.',
        tokenCount: 8,
        headingPath: ['Ch1', 'Trees'],
      },
      replication: {
        content: 'Leaders ship a replication log to followers.',
        tokenCount: 10,
        headingPath: ['Ch2'],
      },
    },
    chunks: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /workspaces/:id/study', () => {
  it('queues a pending study set', async () => {
    const res = await createStudy({ type: 'QUIZ', sourceIds: [book.sourceId] });

    expect(res.status).toBe(202);
    const created = (res.body as { data: { id: string; status: string; input: unknown } }).data;
    expect(created.status).toBe('PENDING');
    expect(created.input).toMatchObject({ sourceIds: [book.sourceId], count: 10 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'study/generate.requested',
        data: { artifactId: created.id },
      }),
    );
  });

  it('checks count, selectors and sources', async () => {
    const tooMany = await createStudy({ type: 'QUIZ', sourceIds: [book.sourceId], count: 50 });
    expect(tooMany.status).toBe(400);
    const counted = await createStudy({ type: 'SUMMARY', sourceIds: [book.sourceId], count: 10 });
    expect(counted.status).toBe(400);
    const both = await createStudy({
      type: 'QUIZ',
      sourceIds: [book.sourceId],
      topic: 'logs',
      pathPrefix: 'src/',
    });
    expect(both.status).toBe(400);

    const other = await bob.post('/api/v1/workspaces').send({ name: 'Bob' });
    const theirs = await seedSource((other.body as { data: { id: string } }).data.id, {
      parents: { p: { content: 'Bob only.', tokenCount: 3 } },
      chunks: {},
    });
    const foreign = await createStudy({ type: 'QUIZ', sourceIds: [theirs.sourceId] });
    expect(foreign.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('generation', () => {
  it('saves a valid quiz with its citations resolved', async () => {
    studyModel((_, numbers) => ({
      title: 'Storage quiz',
      questions: [question(1, [numbers[0]!, 99]), question(2, [99]), question(3, [numbers[1]!])],
    }));

    const id = await generateStudy({ type: 'QUIZ', sourceIds: [book.sourceId], count: 5 });
    const { body } = await getStudy(id);

    expect(body.status).toBe('DONE');
    expect(body.title).toBe('Storage quiz');
    const questions = body.data.questions!;
    expect(questions.map((q) => q.citations)).toEqual([[1], [], [2]]);
    // An item whose only citation pointed nowhere is kept, but flagged.
    expect(questions[1]!.uncited).toBe(true);
    expect(questions[0]!.uncited).toBeUndefined();
    // Only what the items cite is stored, under the numbers they use.
    expect(body.sources.map((s) => s.n)).toEqual([1, 2]);
    expect(body.sources[0]).toMatchObject({ sourceTitle: 'Data Book', heading: 'Ch1' });
    expect(body.sources[0]!.snippet).toContain('Intro');
  });

  it('retries an invalid quiz once with the problems, then fails with the reason', async () => {
    studyModel((_, numbers) => ({
      title: 'Bad quiz',
      questions: [question(1, [numbers[0]!], ['A', 'B', 'C'])],
    }));

    const id = await generateStudy({ type: 'QUIZ', sourceIds: [book.sourceId] });
    const { body } = await getStudy(id);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('Your previous answer was rejected');
    expect(prompts[1]).toContain('Question 1 has 3 options');
    expect(body.status).toBe('FAILED');
    expect(body.error).toMatch(/quiz didn't pass checks: Question 1 has 3 options/);
  });

  it('keeps the retried answer when it passes', async () => {
    studyModel((prompt, numbers) =>
      prompt.includes('previous answer was rejected')
        ? { title: 'Fixed', questions: [question(1, [numbers[0]!]), question(2, [numbers[0]!])] }
        : { title: 'Dupes', questions: [question(1, [numbers[0]!]), question(1, [numbers[0]!])] },
    );

    const id = await generateStudy({ type: 'QUIZ', sourceIds: [book.sourceId] });

    expect(prompts[1]).toContain('Question 2 repeats an earlier question');
    expect((await getStudy(id)).body).toMatchObject({ status: 'DONE', title: 'Fixed' });
  });

  it('builds a mind map tree from the flat node list', async () => {
    studyModel((_, numbers) => ({
      title: 'Map',
      nodes: [
        { id: 'root', parentId: null, label: 'Data', citations: [] },
        { id: 'a', parentId: 'root', label: 'Storage', citations: [numbers[1]!] },
        { id: 'b', parentId: 'a', label: 'Logs', citations: [numbers[1]!] },
        { id: 'stray', parentId: 'missing', label: 'Lost', citations: [] },
      ],
    }));

    const id = await generateStudy({ type: 'MINDMAP', sourceIds: [book.sourceId] });
    const { body } = await getStudy(id);

    expect(body.status).toBe('DONE');
    const root = body.data.root as unknown as { label: string; children: { label: string }[] };
    expect(root.label).toBe('Data');
    expect(root.children.map((child) => child.label)).toEqual(['Storage']);
    expect(JSON.stringify(root)).not.toContain('Lost');
  });

  it('fails without a model call when nothing is indexed', async () => {
    studyModel(() => ({}));
    const empty = await seedSource(workspaceId, { parents: {}, chunks: {} });

    const id = await generateStudy({ type: 'SUMMARY', sourceIds: [empty.sourceId] });

    expect(prompts).toHaveLength(0);
    expect((await getStudy(id)).body).toMatchObject({
      status: 'FAILED',
      error: 'Nothing indexed was found for this selection.',
    });
  });

  /** Condensing and summary models; returns the prompts the condensing model was sent. */
  function useCondensing() {
    const summarizePrompts: string[] = [];
    const condense = promptModel((prompt) => {
      summarizePrompts.push(prompt);
      const numbers = [...prompt.matchAll(/<source n="(\d+)"/g)].map((m) => m[1]);
      return numbers.map((n) => `- passage notes [${n}]`).join('\n');
    });
    const study = promptModel((prompt) => {
      prompts.push(prompt);
      return JSON.stringify({
        title: 'Summary',
        sections: [{ heading: 'All', bullets: [{ text: 'Logs and trees.', citations: [1, 3] }] }],
        keyTerms: [],
      });
    });
    useModels({
      [STUDY.primary!.model]: study,
      [STUDY.fallback!.model]: study,
      [SUMMARIZE.primary!.model]: condense,
      [SUMMARIZE.fallback!.model]: condense,
    });
    return summarizePrompts;
  }

  async function withStudyBudget(maxInputTokens: number, run: () => Promise<void>) {
    const config = appConfig.study as { maxInputTokens: number };
    const original = config.maxInputTokens;
    config.maxInputTokens = maxInputTokens;
    try {
      await run();
    } finally {
      config.maxInputTokens = original;
    }
  }

  it('condenses material too long for one prompt, keeping the original numbers', async () => {
    const summarizePrompts = useCondensing();

    await withStudyBudget(80, async () => {
      const id = await generateStudy({ type: 'SUMMARY', sourceIds: [book.sourceId] });
      const { body } = await getStudy(id);

      expect(summarizePrompts.length).toBeGreaterThan(1);
      expect(prompts[0]).toContain('<notes sources=');
      expect(prompts[0]).not.toContain('<source n=');
      expect(body.status).toBe('DONE');
      expect(body.sources.map((s) => s.n)).toEqual([1, 3]);
    });
  });

  it('never condenses in more than MAX_GROUPS calls', async () => {
    const summarizePrompts = useCondensing();
    // Thirty found sections, far more than four groups hold: the search budget is an
    // estimate, so the count is enforced on the rendered passages.
    const found = Array.from({ length: 30 }, (_, i) => ({
      parentId: `parent-${i}`,
      sourceId: book.sourceId,
      sourceTitle: 'Data Book',
      documentPath: 'book.pdf',
      headingPath: [`Part ${i}`],
      content: `Section ${i} explains how write-ahead logs and compaction keep data safe.`,
      tokenCount: 15,
      childIds: [`child-${i}`],
      score: 1,
    }));
    vi.mocked(search).mockResolvedValue({
      results: found.map((block, i) => ({
        chunkId: `child-${i}`,
        parentId: block.parentId,
        sourceId: book.sourceId,
        sourceTitle: 'Data Book',
        sourceType: 'PDF',
        documentPath: 'book.pdf',
        headingPath: block.headingPath,
        symbolName: null,
        pageStart: i + 1,
        pageEnd: i + 1,
        lineStart: null,
        lineEnd: null,
        content: block.content,
        context: null,
        scores: {},
      })),
      parents: found,
      debug: {} as SearchResult['debug'],
    });

    await withStudyBudget(80, async () => {
      const id = await generateStudy({
        type: 'SUMMARY',
        sourceIds: [book.sourceId],
        topic: 'logs',
      });
      expect((await getStudy(id)).body.status).toBe('DONE');
    });

    // @inngest/test runs parallel steps again on each pass, so count the distinct calls.
    const groups = [...new Set(summarizePrompts)];
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.length).toBeLessThanOrEqual(MAX_GROUPS);
    // Numbered again from 1 after thinning out, without gaps.
    const numbers = groups.flatMap((prompt) =>
      [...prompt.matchAll(/<source n="(\d+)"/g)].map((m) => Number(m[1])),
    );
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});

describe('choosing the material', () => {
  const sourceTexts = (prompt: string) =>
    [...prompt.matchAll(/<source [^>]*>\n([^\n]*)/g)].map((m) => m[1]);

  beforeEach(() => {
    studyModel((_, numbers) => ({
      title: 'Cards',
      cards: numbers.map((n) => ({ front: `Front ${n}`, back: `Back ${n}`, citations: [n] })),
    }));
  });

  it('reads only the chosen TOC section, subsections included', async () => {
    const document = await prismaClient.sourceDocument.findFirstOrThrow({
      where: { sourceId: book.sourceId },
    });
    const node = (id: string, title: string, ordinal: number, parentId: string | null = null) => ({
      id,
      sourceId: book.sourceId,
      documentId: document.id,
      parentId,
      title,
      level: parentId ? 2 : 1,
      ordinal,
      charStart: 0,
      charEnd: 0,
    });
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await prismaClient.tocNode.create({ data: node(ids[0]!, 'Ch1', 0) });
    await prismaClient.tocNode.create({ data: node(ids[1]!, 'Trees', 1, ids[0]) });
    await prismaClient.tocNode.create({ data: node(ids[2]!, 'Ch2', 2) });

    await generateStudy({ type: 'FLASHCARDS', sourceIds: [book.sourceId], tocNodeId: ids[0] });
    expect(sourceTexts(prompts[0]!)).toEqual([
      'Intro: why data systems matter.',
      'Logs append records in order.',
      'B-trees update pages in place.',
    ]);

    await generateStudy({ type: 'FLASHCARDS', sourceIds: [book.sourceId], tocNodeId: ids[1] });
    expect(sourceTexts(prompts[1]!)).toEqual(['B-trees update pages in place.']);

    const missing = await createStudy({
      type: 'FLASHCARDS',
      sourceIds: [book.sourceId],
      tocNodeId: crypto.randomUUID(),
    });
    expect(missing.status).toBe(404);
  });

  it('reads only the files under a folder', async () => {
    const repo = await seedSource(workspaceId, {
      type: 'GITHUB_REPO',
      title: 'acme/db',
      parents: {
        log: { content: 'export function appendLog() {}', tokenCount: 8, path: 'src/log.ts' },
        tree: { content: 'export class BTree {}', tokenCount: 6, path: 'src/tree/btree.ts' },
        docs: { content: '# Readme', tokenCount: 3, path: 'README.md' },
      },
      chunks: {},
    });

    await generateStudy({ type: 'FLASHCARDS', sourceIds: [repo.sourceId], pathPrefix: 'src/' });

    expect(sourceTexts(prompts[0]!)).toEqual([
      'export function appendLog() {}',
      'export class BTree {}',
    ]);
    expect(prompts[0]).toContain('path="src/tree/btree.ts"');
  });

  it('searches for a topic with the study topK', async () => {
    const [chunkId] = (
      await prismaClient.sourceChunk.findMany({
        where: { sourceId: book.sourceId, headingPath: { equals: ['Ch2'] } },
      })
    ).map((chunk) => chunk.id);
    vi.mocked(search).mockResolvedValue({
      results: [
        {
          chunkId: 'child-1',
          parentId: chunkId!,
          sourceId: book.sourceId,
          sourceTitle: 'Data Book',
          sourceType: 'PDF',
          documentPath: 'book.pdf',
          headingPath: ['Ch2'],
          symbolName: null,
          pageStart: 7,
          pageEnd: 8,
          lineStart: null,
          lineEnd: null,
          content: 'Leaders ship',
          context: null,
          scores: {},
        },
      ],
      parents: [
        {
          parentId: chunkId!,
          sourceId: book.sourceId,
          sourceTitle: 'Data Book',
          documentPath: 'book.pdf',
          headingPath: ['Ch2'],
          content: 'Leaders ship a replication log to followers.',
          tokenCount: 10,
          childIds: ['child-1'],
          score: 1,
        },
      ],
      debug: {} as SearchResult['debug'],
    });

    await generateStudy({ type: 'FLASHCARDS', sourceIds: [book.sourceId], topic: 'replication' });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'replication',
        sourceIds: [book.sourceId],
        topK: appConfig.study.topicResults,
        rerank: true,
        maxContextTokens: appConfig.study.maxInputTokens * MAX_GROUPS,
      }),
    );
    expect(sourceTexts(prompts[0]!)).toEqual(['Leaders ship a replication log to followers.']);
    expect(prompts[0]).toContain('pages="7-8"');
  });

  it('samples every source evenly when nothing is chosen', async () => {
    await generateStudy({ type: 'FLASHCARDS', sourceIds: [book.sourceId] });
    // Four parents fit in the sample, so all of them, in reading order.
    expect(sourceTexts(prompts[0]!)).toHaveLength(4);
    expect(sourceTexts(prompts[0]!)[3]).toContain('replication');
  });
});

describe('reading and managing study sets', () => {
  let artifactId: string;

  beforeEach(async () => {
    studyModel((_, numbers) => ({
      title: 'Cards',
      cards: [{ front: 'Log?', back: 'Ordered records.', citations: [numbers[0]!] }],
    }));
    artifactId = await generateStudy({ type: 'FLASHCARDS', sourceIds: [book.sourceId] });
  });

  it('lists by type', async () => {
    send.mockClear();
    await createStudy({ type: 'QUIZ', sourceIds: [book.sourceId] });

    const all = await alice.get(`/api/v1/workspaces/${workspaceId}/study`);
    const cards = await alice.get(`/api/v1/workspaces/${workspaceId}/study?type=FLASHCARDS`);

    const types = (res: typeof all) =>
      (res.body as { data: { items: { type: string; data?: unknown }[] } }).data.items;
    expect(types(all).map((item) => item.type)).toEqual(['QUIZ', 'FLASHCARDS']);
    expect(types(cards).map((item) => item.type)).toEqual(['FLASHCARDS']);
    // The list leaves the items out.
    expect(types(all)[0]!.data).toBeUndefined();
  });

  it('regenerates a finished set, but not one still running', async () => {
    send.mockClear();
    const res = await alice.post(`/api/v1/study/${artifactId}/regenerate`);
    expect(res.status).toBe(202);
    expect((res.body as { data: { status: string } }).data.status).toBe('PENDING');
    expect(send).toHaveBeenCalledTimes(1);

    const again = await alice.post(`/api/v1/study/${artifactId}/regenerate`);
    expect(again.status).toBe(409);
  });

  it('regenerates a set stuck generating for longer than the stale window', async () => {
    const stuckSince = new Date(Date.now() - appConfig.study.staleAfterMs - 60_000);
    await prismaClient.$executeRaw`
      UPDATE "StudyArtifact" SET status = 'RUNNING', "updatedAt" = ${stuckSince}
      WHERE id = ${artifactId}
    `;

    const res = await alice.post(`/api/v1/study/${artifactId}/regenerate`);
    expect(res.status).toBe(202);
    expect((res.body as { data: { status: string } }).data.status).toBe('PENDING');
  });

  it('queues one run when two regenerates race', async () => {
    send.mockClear();
    const statuses = await Promise.all(
      [1, 2].map(async () => (await alice.post(`/api/v1/study/${artifactId}/regenerate`)).status),
    );

    expect(statuses.sort()).toEqual([202, 409]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps other users out, and lets them only read the demo's", async () => {
    expect((await getStudy(artifactId, bob)).status).toBe(404);
    expect((await bob.get(`/api/v1/workspaces/${workspaceId}/study`)).status).toBe(404);
    expect((await createStudy({ type: 'QUIZ', sourceIds: [book.sourceId] }, bob)).status).toBe(404);

    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });
    expect((await getStudy(artifactId, bob)).status).toBe(200);
    expect((await bob.get(`/api/v1/workspaces/${workspaceId}/study`)).status).toBe(200);
    expect((await createStudy({ type: 'QUIZ', sourceIds: [book.sourceId] }, bob)).status).toBe(404);
    expect((await bob.post(`/api/v1/study/${artifactId}/regenerate`)).status).toBe(404);
    expect((await bob.delete(`/api/v1/study/${artifactId}`)).status).toBe(404);
  });

  it('deletes', async () => {
    expect((await alice.delete(`/api/v1/study/${artifactId}`)).status).toBe(204);
    expect((await getStudy(artifactId)).status).toBe(404);
  });
});

describe('model failures', () => {
  const input: StudyInput = { sourceIds: ['s'], count: 5, difficulty: 'medium' };
  const run = () => generateOnce('QUIZ', input, '<source n="1">\nText\n</source>', [1], {});

  it('turns output that misses the schema into feedback', async () => {
    useModels({
      [STUDY.primary!.model]: scriptedModel(['not json']),
      [STUDY.fallback!.model]: scriptedModel(['{"title": 3}']),
    });

    await expect(run()).resolves.toEqual({
      errors: ["The answer wasn't valid JSON for the required schema."],
    });
  });

  it('throws other failures, so the step is retried', async () => {
    useModels({
      [STUDY.primary!.model]: scriptedModel([apiError(400)]),
      [STUDY.fallback!.model]: scriptedModel([apiError(400)]),
    });

    await expect(run()).rejects.toBeInstanceOf(UpstreamError);
  });
});
